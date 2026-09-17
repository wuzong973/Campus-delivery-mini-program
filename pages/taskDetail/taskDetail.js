const api = require("../../utils/api");
const { resolveTaskCloudImages } = require("../../utils/cloudImages");
const subscribe = require("../../utils/subscribe");

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

// 服务端在无权限时会把联系方式替换成「接单后可见」这类文案，
// 这里必须先确认拿到的是真正的号码再拨号，避免把提示文案当成电话号码。
function isPhoneLike(value) {
  return /^\d{5,20}$/.test(String(value || "").trim());
}

Page({
  data: {
    id: "",
    initialized: false,
    loading: true,
    submitting: false,
    uploadingProof: false,
    errorMessage: "",
    task: {},
    rateScore: 5,
    rateComment: "",
  },

  // 分享给好友：携带任务 id，打开即定位到该任务详情，同时使右上角胶囊菜单支持「复制链接」
  onShareAppMessage() {
    const id = this.data.id || "";
    return {
      title: "校园代拿 - 来看看这个代拿任务",
      path: `/pages/taskDetail/taskDetail?id=${id}`,
      imageUrl: ""
    };
  },

  // 分享到朋友圈：query 携带任务 id
  onShareTimeline() {
    const id = this.data.id || "";
    return {
      title: "校园代拿 - 来看看这个代拿任务",
      query: `id=${id}`
    };
  },

  onLoad(options) {
    this.setData({
      id: options.id || "",
    });
    this.loadDetail(true);
  },

  onShow() {
    if (this.data.initialized) {
      this.loadDetail(false);
    }
  },

  loadDetail(showLoading) {
    // 缺少任务 id（例如从分享链接打开但参数丢失）时直接落到空态，
    // 否则页面会一直停在 loading 状态显示白屏。
    if (!this.data.id) {
      this.setData({
        initialized: true,
        loading: false,
        errorMessage: "缺少任务信息，请从任务列表重新进入。",
      });
      return Promise.resolve();
    }

    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    return api
      .getTaskDetail(this.data.id)
      .then((task) => resolveTaskCloudImages(task))
      .then((task) => {
        this.setData({
          initialized: true,
          loading: false,
          errorMessage: "",
          task,
          rateScore: task.rating ? task.rating.score : 5,
          rateComment: task.rating ? task.rating.comment || "" : "",
        });
      })
      .catch((error) => {
        // 失败时结束 loading 并记录错误文案，供空态区域展示，避免整页白屏。
        this.setData({
          initialized: true,
          loading: false,
          errorMessage: (error && error.message) || "加载失败，请稍后重试。",
        });
        wx.showToast({
          title: (error && error.message) || "加载失败",
          icon: "none",
        });
      })
      .finally(() => {
        if (showLoading) {
          wx.hideLoading();
        }
      });
  },

  contactPhone(phone) {
    if (!phone) {
      wx.showToast({
        title: "当前不可查看联系方式",
        icon: "none",
      });
      return;
    }

    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => {
        wx.setClipboardData({
          data: phone,
        });
      },
    });
  },

  getCurrentLocation() {
    return new Promise((resolve) => {
      wx.getLocation({
        type: "gcj02",
        success: (result) => {
          resolve({
            latitude: result.latitude,
            longitude: result.longitude,
          });
        },
        fail: () => resolve(null),
      });
    });
  },

  showContactOptions(event) {
    const userType = event.currentTarget.dataset.userType;
    const task = this.data.task;
    let phone = "";
    let targetUser = null;

    if (userType === "publisher") {
      // 服务端已按 canViewContact 脱敏：无权限时 contactPhone 是空字符串
      phone = task.contactPhone;
      targetUser = task.publisher;
    } else if (userType === "runner") {
      // 用权限位判断，而不是比对中文文案 —— 旧实现写死 === "接单后可见"，
      // 后端一改文案权限判断就失效
      phone =
        task.canViewContact && isPhoneLike(task.runnerPhoneText)
          ? task.runnerPhoneText
          : "";
      targetUser = task.runner;
    }

    if (!targetUser) {
      wx.showToast({
        title: "用户信息错误",
        icon: "none",
      });
      return;
    }

    if (
      (userType === "publisher" && task.isMine) ||
      (userType === "runner" && task.isRunner)
    ) {
      wx.showToast({
        title: "当前对象就是你自己",
        icon: "none",
      });
      return;
    }

    wx.showActionSheet({
      itemList: ["在线联系", "电话联系"],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({
            url: `/pages/chat/detail/detail?orderId=${this.data.id}&targetUserId=${targetUser.id}&targetUserName=${encodeURIComponent(targetUser.nickname || "")}`,
          });
        } else if (res.tapIndex === 1) {
          this.contactPhone(phone);
        }
      },
      fail(res) {
        console.log(res.errMsg);
      },
    });
  },

  handleContactPublisher() {
    this.showContactOptions({
      currentTarget: { dataset: { userType: "publisher" } },
    });
  },

  handleContactRunner() {
    if (!this.data.task.runner) {
      return;
    }
    this.showContactOptions({
      currentTarget: { dataset: { userType: "runner" } },
    });
  },

  handleCollect() {
    api
      .toggleCollectTask(this.data.id)
      .then((result) => {
        this.setData({
          "task.isCollected": result.isCollected,
        });
        wx.showToast({
          title: result.isCollected ? "已收藏" : "已取消收藏",
          icon: "success",
        });
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "操作失败",
          icon: "none",
        });
      });
  },

  // 接单按钮入口（bindtap）
  // 集成一次性订阅消息：在用户点击「接单」时同步唤起「接单成功通知」授权弹窗。
  // 微信规则：requestSubscribeMessage 必须由用户点击事件同步触发，
  // 不能放在 wx.showModal 的 success 回调中（会脱离点击手势上下文而报错），
  // 因此先唤起订阅授权，再弹出原有的接单确认框。
  // 无论同意/拒绝都不阻断接单业务。
  handleAccept() {
    if (this.data.submitting) {
      return;
    }

    // 先唤起一次性订阅消息授权（接单成功通知），授权后再弹接单确认框
    subscribe.requestSubscribe("orderAccepted").then((subscribeResult) => {
      // subscribeResult.status: 'accept' | 'reject' | 'ban' | 'unsupported' | 'fail'
      // 同意/拒绝回调判断：不阻断接单业务；实际项目可在此把授权结果上报后端
      if (subscribeResult.status === "accept") {
        console.log("[订阅] 骑手同意接单成功通知", subscribeResult.accepted);
      } else {
        console.log("[订阅] 骑手未同意接单成功通知", subscribeResult.status);
      }

      // 以下为原有接单确认与执行流程（逻辑保持不变）
      wx.showModal({
        title: "确认接单",
        content: "接单后将展示双方联系方式，并计入你的在途订单数量，确认继续吗？",
        success: (result) => {
          if (!result.confirm) {
            return;
          }

          this.setData({ submitting: true });
          wx.showLoading({ title: "接单中", mask: true });

          this.getCurrentLocation()
            .then((currentLocation) =>
              api.acceptTask(this.data.id, currentLocation),
            )
            .then((task) => resolveTaskCloudImages(task))
            .then((task) => {
              wx.hideLoading();
              this.setData({ task });
              wx.showToast({
                title: "接单成功",
                icon: "success",
              });
            })
            .catch((error) => {
              wx.hideLoading();
              wx.showToast({
                title: error.message || "接单失败",
                icon: "none",
              });
            })
            .finally(() => {
              this.setData({ submitting: false });
            });
        },
      });
    }); // 结束 subscribe.requestSubscribe
  },

  // 取消订单：仅在订单可取消的状态下展示（见 taskDetail.wxml）
  handleCancel() {
    if (this.data.submitting) {
      return;
    }

    wx.showModal({
      title: "确认取消订单",
      content: "取消后，已支付的款项将原路退回，确认继续吗？",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        this.setData({ submitting: true });
        wx.showLoading({ title: "取消中", mask: true });

        api
          .cancelOrder(this.data.id)
          .then((task) => resolveTaskCloudImages(task))
          .then((task) => {
            wx.hideLoading();
            this.setData({ task });
            wx.showToast({
              title: "订单已取消",
              icon: "success",
            });
          })
          .catch((error) => {
            wx.hideLoading();
            wx.showToast({
              title: error.message || "取消失败",
              icon: "none",
            });
          })
          .finally(() => {
            this.setData({ submitting: false });
          });
      },
    });
  },

  handlePay() {
    // 防连点：支付没有锁时，连续点击会并发发起多次预支付请求
    if (this.data.submitting) {
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "拉起支付中", mask: true });

    api
      .requestEscrowPayment(this.data.id)
      .then((result) => {
        wx.hideLoading();
        wx.showToast({
          title:
            result && result.payStatus === "paid"
              ? "支付成功"
              : "支付结果确认中",
          icon: result && result.payStatus === "paid" ? "success" : "none",
        });
        this.loadDetail(false);
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({
          title: error.message || "支付失败，请稍后重试",
          icon: "none",
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  handleUploadProof() {
    if (this.data.uploadingProof) {
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      success: (result) => {
        const tempFile = result.tempFiles && result.tempFiles[0];

        if (!tempFile || !tempFile.tempFilePath) {
          wx.showToast({
            title: "未获取到图片，请重试",
            icon: "none",
          });
          return;
        }

        if (tempFile.size && tempFile.size > MAX_UPLOAD_SIZE) {
          wx.showToast({
            title: "图片过大，请选择 10MB 内的照片",
            icon: "none",
          });
          return;
        }

        this.setData({ uploadingProof: true });
        wx.showLoading({ title: "上传中", mask: true });

        api
          .uploadDeliveryProof(
            this.data.id,
            tempFile.tempFilePath,
            "已拍照送达，请继续确认完成订单",
          )
          .then((task) => resolveTaskCloudImages(task))
          .then((task) => {
            wx.hideLoading();
            this.setData({ task });
            wx.showToast({
              title: "送达照片上传成功",
              icon: "success",
            });
            this.loadDetail(false);
          })
          .catch((error) => {
            wx.hideLoading();
            wx.showModal({
              title: "上传失败",
              content: error.message || "送达照片上传失败，请重试",
              confirmText: "重新上传",
              cancelText: "稍后再试",
              success: (modalResult) => {
                if (modalResult.confirm) {
                  this.handleUploadProof();
                }
              },
            });
          })
          .finally(() => {
            this.setData({ uploadingProof: false });
          });
      },
    });
  },

  handleComplete() {
    // 防连点：重复提交会触发多次结算请求
    if (this.data.submitting) {
      return;
    }

    wx.showModal({
      title: "完成订单",
      content: "确认订单已送达并完成结算吗？完成后收益会进入余额。",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        this.setData({ submitting: true });
        wx.showLoading({ title: "结算中", mask: true });
        api
          .completeOrder(this.data.id)
          .then((task) => resolveTaskCloudImages(task))
          .then((task) => {
            wx.hideLoading();
            this.setData({ task });
            wx.showToast({
              title: "订单已完成",
              icon: "success",
            });
          })
          .catch((error) => {
            wx.hideLoading();
            wx.showToast({
              title: error.message || "操作失败",
              icon: "none",
            });
          })
          .finally(() => {
            this.setData({ submitting: false });
          });
      },
    });
  },

  selectRate(event) {
    this.setData({
      rateScore: Number(event.currentTarget.dataset.score),
    });
  },

  handleRateComment(event) {
    this.setData({
      rateComment: event.detail.value,
    });
  },

  submitRating() {
    // 防连点：重复提交会重复计算跑腿员平均分并重复发通知
    if (this.data.submitting) {
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中", mask: true });

    api
      .rateRunner(this.data.id, {
        score: this.data.rateScore,
        comment: this.data.rateComment,
      })
      .then((task) => resolveTaskCloudImages(task))
      .then((task) => {
        wx.hideLoading();
        this.setData({ task });
        wx.showToast({
          title: "评价成功",
          icon: "success",
        });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({
          title: error.message || "评价失败",
          icon: "none",
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  openLocation(event) {
    const location = event.currentTarget.dataset.location;

    if (!location || !location.latitude || !location.longitude) {
      wx.showToast({
        title: "暂无定位信息",
        icon: "none",
      });
      return;
    }

    wx.openLocation({
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name || "",
      address: location.address || "",
    });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.src;
    const urls = (this.data.task.attachments || [])
      .map((item) => item.displayUrl || item.filePath)
      .filter(Boolean);

    wx.previewImage({
      current,
      urls: urls.length ? urls : [current],
    });
  },

  goToOrder() {
    wx.switchTab({
      url: "/pages/order/order",
    });
  },
});

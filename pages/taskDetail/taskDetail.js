const api = require("../../utils/api");
const { resolveTaskCloudImages } = require("../../utils/cloudImages");

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

Page({
  data: {
    id: "",
    initialized: false,
    loading: true,
    submitting: false,
    uploadingProof: false,
    task: {},
    rateScore: 5,
    rateComment: "",
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
    if (!this.data.id) {
      return;
    }

    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    api
      .getTaskDetail(this.data.id)
      .then((task) => resolveTaskCloudImages(task))
      .then((task) => {
        this.setData({
          initialized: true,
          loading: false,
          task,
          rateScore: task.rating ? task.rating.score : 5,
          rateComment: task.rating ? task.rating.comment || "" : "",
        });
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "加载失败",
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

  handleContactPublisher() {
    this.contactPhone(this.data.task.contactPhone);
  },

  handleContactRunner() {
    if (!this.data.task.runner) {
      return;
    }

    this.contactPhone(
      this.data.task.runnerPhoneText === "接单后可见"
        ? ""
        : this.data.task.runner.phone,
    );
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

  handleAccept() {
    if (this.data.submitting) {
      return;
    }

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
          .then((currentLocation) => api.acceptTask(this.data.id, currentLocation))
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
  },

  handlePay() {
    wx.showLoading({ title: "拉起支付中", mask: true });
    api
      .requestEscrowPayment(this.data.id)
      .then((result) => {
        wx.hideLoading();
        wx.showToast({
          title: result && result.payStatus === "paid" ? "支付成功" : "支付结果确认中",
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
    wx.showModal({
      title: "完成订单",
      content: "确认订单已送达并完成结算吗？完成后收益会进入余额。",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

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
          });
      },
    });
  },

  handleCancel() {
    wx.showModal({
      title: "取消订单",
      content: "确认取消订单吗？只有发布者可取消未接单订单。",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        wx.showLoading({ title: "处理中", mask: true });
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
              title: error.message || "操作失败",
              icon: "none",
            });
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

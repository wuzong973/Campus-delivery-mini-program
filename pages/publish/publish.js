const api = require("../../utils/api");
const business = require("../../utils/business");
const subscribe = require("../../utils/subscribe");

const DYNAMIC_FEES = {
  largeItemFee: 1,
  itemCountFee: 0.5,
  urgentFee: 1,
};

function createDefaultForm(profile) {
  return {
    receiverName: "",
    contactPhone: profile.phone || "",
    type: "takeout",
    pickupAddress: "",
    pickupLocation: null,
    deliveryAddress: profile.commonAddress || "",
    deliveryLocation: null,
    pickupTimeType: "asap",
    pickupTimeValue: "",
    deliveryBuilding: "",
    deliveryRoom: "",
    remark: "",
    basePrice: "2.00",
    basePriceMin: 2,
    isLargeItem: false,
    itemCount: "1",
    isUrgent: false,
    attachments: [],
  };
}

function createEmptyProfileState() {
  return {
    isComplete: false,
    missingFields: ["昵称", "手机号", "常用地址"],
    missingText: "昵称、手机号、常用地址",
  };
}

Page({
  data: {
    loading: true,
    submitting: false,
    profile: null,
    profileState: createEmptyProfileState(),
    profileCommonAddressText: "未设置",
    typeOptions: business.TYPE_OPTIONS,
    pickupTimeOptions: [
      { label: "尽快", value: "asap" },
      { label: "预约", value: "scheduled" },
    ],
    form: createDefaultForm({}),
    dynamicFees: DYNAMIC_FEES,
    summary: {
      base: 2,
      largeItem: 0,
      itemCount: 0,
      urgent: 0,
      total: 2,
    },
    summaryFormatted: {
      base: "2.00",
      largeItem: "0.00",
      itemCount: "0.00",
      urgent: "0.00",
      total: "2.00",
    },
    feeInfo: {
      platformFee: "¥0.02",
      runnerIncome: "¥1.98",
    },
  },

  // 分享给好友：定义本方法后，右上角胶囊菜单才会显示「转发」并支持「复制链接」
  onShareAppMessage() {
    return {
      title: "校园代拿 - 来发个代拿任务吧",
      path: "/pages/publish/publish",
      imageUrl: ""
    };
  },

  // 分享到朋友圈：定义本方法后，右上角菜单支持「分享到朋友圈」
  onShareTimeline() {
    return {
      title: "校园代拿 - 来发个代拿任务吧",
      query: ""
    };
  },

  onLoad() {
    this.loadProfile(true);
  },

  onShow() {
    // 用户可能刚去「个人资料」页补全信息再返回本页。
    // 若不重新拉取，profileState 会保持旧值，导致 validateForm 一直提示「请先完善个人资料」。
    // 注意：这里只刷新资料与校验状态，绝不能重置 form，
    // 否则用户切个 tab 回来正在填写的表单就被清空了。
    if (!this.data.loading) {
      this.refreshProfileState();
    }
  },

  refreshProfileState() {
    return api
      .getCurrentUserProfile()
      .then((profile) => {
        this.setData({
          profile,
          profileState: business.getProfileCompletion(profile || {}),
          profileCommonAddressText:
            profile && profile.commonAddress ? profile.commonAddress : "未设置",
        });
      })
      .catch(() => {
        // 静默刷新失败不影响用户继续填写表单
      });
  },

  loadProfile(showLoading) {
    if (showLoading !== false) {
      wx.showLoading({ title: "加载中", mask: true });
    }
    api
      .getCurrentUserProfile()
      .then((profile) => {
        const profileState = business.getProfileCompletion(profile || {});
        const form = createDefaultForm(profile || {});
        const total = this.calculateTotalReward(form);
        this.setData({
          loading: false,
          profile,
          profileState,
          profileCommonAddressText:
            profile && profile.commonAddress ? profile.commonAddress : "未设置",
          form,
          ...this.buildSummaryState(total),
        });
      })
      .catch((error) => {
        this.setData({ loading: false });
        wx.showToast({
          title: error.message || "加载资料失败",
          icon: "none",
        });
      })
      .finally(() => {
        if (showLoading !== false) {
          wx.hideLoading();
        }
      });
  },

  buildSummaryState(total) {
    const summary = {
      base: total.base,
      largeItem: total.largeItem,
      itemCount: total.itemCount,
      urgent: total.urgent,
      total: total.total,
    };

    return {
      summary,
      summaryFormatted: {
        base: summary.base.toFixed(2),
        largeItem: summary.largeItem.toFixed(2),
        itemCount: summary.itemCount.toFixed(2),
        urgent: summary.urgent.toFixed(2),
        total: summary.total.toFixed(2),
      },
      feeInfo: api.getPlatformFeeHint(summary.total),
    };
  },

  calculateTotalReward(form) {
    const base = Math.max(2, Number(form.basePrice || 2) || 2);
    const itemCount = Number(form.itemCount || 0);
    const largeItem =
      form.type === "parcel" && form.isLargeItem ? DYNAMIC_FEES.largeItemFee : 0;
    const multiItem =
      form.type === "helpBuy" && itemCount > 5 ? DYNAMIC_FEES.itemCountFee : 0;
    const urgent = form.isUrgent ? DYNAMIC_FEES.urgentFee : 0;
    const total = Number((base + largeItem + multiItem + urgent).toFixed(2));

    return {
      base,
      largeItem,
      itemCount: multiItem,
      urgent,
      total,
    };
  },

  refreshSummary(form) {
    const total = this.calculateTotalReward(form);
    this.setData(this.buildSummaryState(total));
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    const form = Object.assign({}, this.data.form, { [field]: value });

    this.setData({ form });
    this.refreshSummary(form);
  },

  handleBasePriceInput(event) {
    const rawValue = String((event.detail && event.detail.value) || "").trim();
    const form = Object.assign({}, this.data.form, {
      basePrice: rawValue,
    });
    this.setData({ form });
    this.refreshSummary(form);
  },

  handleBasePriceBlur(event) {
    const rawValue = String((event.detail && event.detail.value) || "").trim();
    let amount = Number(rawValue);

    if (!rawValue) {
      amount = 2;
    }

    if (Number.isNaN(amount)) {
      amount = 2;
    }

    if (amount < 2) {
      amount = 2;
      wx.showToast({
        title: "基础金额不能低于 2 元",
        icon: "none",
      });
    }

    const form = Object.assign({}, this.data.form, {
      basePrice: amount.toFixed(2),
    });
    this.setData({ form });
    this.refreshSummary(form);
  },

  handleSwitchChange(event) {
    const field = event.currentTarget.dataset.field;
    const form = Object.assign({}, this.data.form, {
      [field]: !!event.detail.value,
    });
    this.setData({ form });
    this.refreshSummary(form);
  },

  switchType(event) {
    const nextType = event.currentTarget.dataset.value;
    const form = Object.assign({}, this.data.form, {
      type: nextType,
      isLargeItem: nextType === "parcel" ? this.data.form.isLargeItem : false,
      itemCount: nextType === "helpBuy" ? this.data.form.itemCount : "1",
    });
    this.setData({ form });
    this.refreshSummary(form);
  },

  switchPickupTime(event) {
    const nextType = event.currentTarget.dataset.value;
    const form = Object.assign({}, this.data.form, {
      pickupTimeType: nextType,
      pickupTimeValue: nextType === "scheduled" ? this.data.form.pickupTimeValue : "",
    });
    this.setData({ form });
  },

  fillCommonAddress() {
    const commonAddress = this.data.profile && this.data.profile.commonAddress;

    if (!commonAddress) {
      wx.showToast({
        title: "请先在个人资料中填写常用地址",
        icon: "none",
      });
      return;
    }

    this.setData({
      "form.deliveryAddress": commonAddress,
    });
  },

  chooseLocation(event) {
    const field = event.currentTarget.dataset.field;
    wx.chooseLocation({
      success: (location) => {
        const addressKey = field === "pickup" ? "pickupAddress" : "deliveryAddress";
        const locationKey = field === "pickup" ? "pickupLocation" : "deliveryLocation";
        this.setData({
          [`form.${addressKey}`]: location.address || location.name || "",
          [`form.${locationKey}`]: {
            latitude: location.latitude,
            longitude: location.longitude,
            name: location.name || "",
            address: location.address || "",
          },
        });
      },
      fail: (error) => {
        if (error && /cancel/i.test(error.errMsg || "")) {
          return;
        }
        wx.showToast({
          title: "定位失败，请手动输入地址",
          icon: "none",
        });
      },
    });
  },

  chooseAttachment() {
    const remainCount = 3 - (this.data.form.attachments || []).length;

    if (remainCount <= 0) {
      wx.showToast({
        title: "最多上传 3 张图片",
        icon: "none",
      });
      return;
    }

    wx.chooseMedia({
      count: remainCount,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const files = (result.tempFiles || []).map((item, index) => ({
          filePath: item.tempFilePath,
          size: item.size || 0,
          name: `attachment-${Date.now()}-${index + 1}.jpg`,
          type: "order_attachment",
        }));

        this.setData({
          "form.attachments": this.data.form.attachments.concat(files).slice(0, 3),
        });
      },
    });
  },

  removeAttachment(event) {
    const index = Number(event.currentTarget.dataset.index);
    const attachments = (this.data.form.attachments || []).slice();
    attachments.splice(index, 1);
    this.setData({
      "form.attachments": attachments,
    });
  },

  goUserInfo() {
    wx.navigateTo({
      url: "/pages/userInfo/userInfo",
    });
  },

  validateForm() {
    const { form, profileState } = this.data;

    if (!profileState.isComplete) return "请先完善个人资料";
    if (!String(form.receiverName || "").trim()) return "请填写收件人姓名";
    if (!business.isPhone(form.contactPhone)) return "请填写正确的手机号";
    if (!String(form.pickupAddress || "").trim()) return "请填写取件地址";
    if (!String(form.deliveryAddress || "").trim()) return "请填写送达地址";
    if (!String(form.deliveryBuilding || "").trim()) return "请填写送达楼栋";
    if (!String(form.deliveryRoom || "").trim()) return "请填写宿舍号";
    if (form.pickupTimeType === "scheduled" && !String(form.pickupTimeValue || "").trim()) {
      return "请填写预约取件时间";
    }
    if (!String(form.remark || "").trim()) return "请填写备注信息";

    return "";
  },

  buildSubmitPayload() {
    const { form, summary } = this.data;
    return {
      receiverName: String(form.receiverName || "").trim(),
      contactPhone: String(form.contactPhone || "").trim(),
      type: form.type,
      pickupAddress: String(form.pickupAddress || "").trim(),
      pickupLocation: form.pickupLocation || null,
      deliveryAddress: String(form.deliveryAddress || "").trim(),
      deliveryLocation: form.deliveryLocation || null,
      pickupTimeType: form.pickupTimeType,
      pickupTimeValue: String(form.pickupTimeValue || "").trim(),
      deliveryBuilding: String(form.deliveryBuilding || "").trim(),
      deliveryRoom: String(form.deliveryRoom || "").trim(),
      remark: String(form.remark || "").trim(),
      basePrice: Math.max(2, Number(form.basePrice || 2) || 2),
      rewardAmount: summary.total,
      isLargeItem: !!form.isLargeItem,
      itemCount: Number(form.itemCount || 0),
      isUrgent: !!form.isUrgent,
      attachments: form.attachments || [],
    };
  },

  // 提交订单按钮入口（bindtap）
  // 集成一次性订阅消息：在用户点击「提交订单」时同步唤起「下单成功通知」授权弹窗。
  // 微信规则：wx.requestSubscribeMessage 必须由用户点击事件同步触发，
  // 因此放在校验通过后、发起请求前的同步调用链中。无论同意/拒绝都不阻断下单业务。
  handleSubmit() {
    if (this.data.submitting) {
      return;
    }

    const validationMessage = this.validateForm();
    if (validationMessage) {
      wx.showToast({
        title: validationMessage,
        icon: "none",
      });
      return;
    }

    const payload = this.buildSubmitPayload();
    let createdOrderId = "";

    // 唤起一次性订阅消息授权（下单成功通知）
    subscribe.requestSubscribe("orderCreated").then((subscribeResult) => {
      // subscribeResult.status: 'accept' | 'reject' | 'ban' | 'unsupported' | 'fail'
      // 同意/拒绝回调判断：不阻断业务；实际项目可在此把授权结果上报后端，
      // 便于后端在订单创建成功后判断是否可向该用户下发订阅消息
      if (subscribeResult.status === "accept") {
        console.log("[订阅] 用户同意下单成功通知", subscribeResult.accepted);
      } else {
        console.log("[订阅] 用户未同意下单成功通知", subscribeResult.status);
      }

      // 以下为原有下单业务流程（逻辑保持不变）：创建订单 -> 唤起支付 -> 跳转订单页
      this.setData({ submitting: true });
      wx.showLoading({ title: "发布中", mask: true });

      api
        .createTask(payload)
        .then((order) => {
          createdOrderId = order && (order.id || order._id);
          return api.requestEscrowPayment(createdOrderId);
        })
        .then((paymentResult) => {
          wx.hideLoading();
          wx.showToast({
            title:
              paymentResult && paymentResult.payStatus === "paid"
                ? "发布并支付成功"
                : "支付结果确认中",
            icon:
              paymentResult && paymentResult.payStatus === "paid" ? "success" : "none",
          });
          setTimeout(() => {
            wx.switchTab({
              url: "/pages/order/order",
            });
          }, 500);
        })
        .catch((error) => {
          wx.hideLoading();
          const code = error && error.code;

          if (createdOrderId && (code === "PAY_CANCEL" || code === "PAY_PENDING")) {
            wx.showModal({
              title: code === "PAY_CANCEL" ? "支付已取消" : "支付结果确认中",
              content:
                code === "PAY_CANCEL"
                  ? "订单已创建，可前往订单页继续支付。"
                  : "订单已创建，支付结果正在确认，请到订单页查看。",
              confirmText: "去订单页",
              cancelText: "留在当前页",
              success: (result) => {
                if (result.confirm) {
                  wx.switchTab({
                    url: "/pages/order/order",
                  });
                }
              },
            });
            return;
          }

          wx.showToast({
            title: (error && error.message) || "发布失败，请稍后重试",
            icon: "none",
          });
        })
        .finally(() => {
          this.setData({ submitting: false });
        });
    }); // 结束 subscribe.requestSubscribe
  },
});

const api = require("../../utils/api");
const business = require("../../utils/business");

const DYNAMIC_FEES = {
  largeItemFee: 1,
  itemCountFee: 0.5,
  urgentFee: 1,
};

function createDefaultForm(profile) {
  return {
    receiverName: profile.nickname || "",
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
    basePrice: 2.0,
    isLargeItem: false,
    itemCount: 1,
    isUrgent: false,
    attachments: [],
  };
}

Page({
  data: {
    loading: true,
    submitting: false,
    typeOptions: business.TYPE_OPTIONS,
    pickupTimeOptions: [
      { label: "尽快", value: "asap" },
      { label: "预约", value: "scheduled" },
    ],
    profile: {
      commonAddress: "",
    },
    profileState: {
      isComplete: false,
      missingText: "昵称、手机号、常用地址",
    },
    profileCommonAddressText: "未设置",
    dynamicFees: DYNAMIC_FEES,
    feeInfo: {
      platformFee: "¥0.00",
      runnerIncome: "¥0.00",
    },
    summary: {
      base: 2.0,
      largeItem: 0,
      itemCount: 0,
      urgent: 0,
      total: 2.0,
    },
    summaryFormatted: {
      base: "2.00",
      largeItem: "0.00",
      itemCount: "0.00",
      urgent: "0.00",
      total: "2.00",
    },
    form: createDefaultForm({}),
  },

  onLoad() {
    this.loadProfile();
    this.calculateTotalReward();
  },

  loadProfile() {
    wx.showLoading({ title: "加载中", mask: true });

    api
      .getCurrentUserProfile()
      .then((profile) => {
        const profileState = business.getProfileCompletion(profile || {});
        this.setData(
          {
            loading: false,
            profile,
            profileState,
            profileCommonAddressText: profile.commonAddress || "未设置",
            form: createDefaultForm(profile || {}),
          },
          () => this.calculateTotalReward(),
        );
      })
      .catch((error) => {
        wx.showToast({ title: error.message || "加载失败", icon: "none" });
        this.setData({ loading: false });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  handlePriceInput(event) {
    let value = event.detail.value;
    // 通过正则限制，只允许输入一个小数点和数字
    value = value.replace(/[^\d.]/g, "");
    value = value.replace(/\.{2,}/g, ".");
    value = value.replace(/^(\d+\.\d{2}).*$/, "$1");

    this.setData({ "form.basePrice": value });
    // 延迟计算，避免过于频繁的setData
    if (this.priceCalcTimer) clearTimeout(this.priceCalcTimer);
    this.priceCalcTimer = setTimeout(() => {
      this.calculateTotalReward();
    }, 300);
  },

  handlePriceBlur(event) {
    const value = parseFloat(event.detail.value);

    if (isNaN(value) || value <= 0) {
      wx.showToast({ title: "请输入有效的金额", icon: "none" });
      this.setData({ "form.basePrice": "" }, () => {
        this.calculateTotalReward();
      });
      return;
    }

    if (value < 2) {
      wx.showToast({ title: "最低悬赏金额为2元", icon: "none" });
      this.setData({ "form.basePrice": 2.0 }, () => {
        this.calculateTotalReward();
      });
    }
  },

  calculateTotalReward() {
    const { form } = this.data;
    const base = parseFloat(form.basePrice) || 0;
    const itemCount = Math.max(1, parseInt(form.itemCount || 1, 10) || 1);
    const largeItemFee =
      form.type === "parcel" && form.isLargeItem
        ? DYNAMIC_FEES.largeItemFee
        : 0;
    const itemCountFee =
      form.type === "helpBuy" && itemCount > 5 ? DYNAMIC_FEES.itemCountFee : 0;
    const urgentFee = form.isUrgent ? DYNAMIC_FEES.urgentFee : 0;
    const total = base + largeItemFee + itemCountFee + urgentFee;

    const summary = {
      base,
      largeItem: largeItemFee,
      itemCount: itemCountFee,
      urgent: urgentFee,
      total,
    };

    this.setData({
      "form.itemCount": itemCount,
      summary,
      summaryFormatted: {
        base: summary.base.toFixed(2),
        largeItem: summary.largeItem.toFixed(2),
        itemCount: summary.itemCount.toFixed(2),
        urgent: summary.urgent.toFixed(2),
        total: summary.total.toFixed(2),
      },
      feeInfo: api.getPlatformFeeHint(total),
    });
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({ [`form.${field}`]: value }, () => {
      if (field === "itemCount") {
        this.calculateTotalReward();
      }
    });
  },

  handleSwitchChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({ [`form.${field}`]: value }, () => {
      this.calculateTotalReward();
    });
  },

  switchType(event) {
    const value = event.currentTarget.dataset.value;
    this.setData(
      {
        "form.type": value,
        "form.isLargeItem":
          value === "parcel" ? this.data.form.isLargeItem : false,
        "form.itemCount": value === "helpBuy" ? this.data.form.itemCount : 1,
      },
      () => this.calculateTotalReward(),
    );
  },

  switchPickupTime(event) {
    this.setData({
      "form.pickupTimeType": event.currentTarget.dataset.value,
    });
  },

  fillCommonAddress() {
    this.setData({
      "form.deliveryAddress": this.data.profile.commonAddress || "",
    });
  },

  chooseLocation(event) {
    const field = event.currentTarget.dataset.field;
    wx.chooseLocation({
      success: (result) => {
        const addressText = result.name
          ? `${result.name} ${result.address}`
          : result.address;
        this.setData({
          [`form.${field}Address`]: (addressText || "").trim(),
          [`form.${field}Location`]: {
            latitude: result.latitude,
            longitude: result.longitude,
            name: result.name,
            address: result.address,
          },
        });
      },
      fail: (error) => {
        if (error.errMsg && error.errMsg.includes("cancel")) {
          return;
        }
        wx.showToast({
          title: "地图定位失败，请手动输入地址",
          icon: "none",
        });
      },
    });
  },

  chooseAttachment() {
    const remainCount = Math.max(0, 3 - this.data.form.attachments.length);
    if (!remainCount) {
      wx.showToast({ title: "最多上传 3 张图片", icon: "none" });
      return;
    }

    wx.chooseMedia({
      count: remainCount,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const files = result.tempFiles.map((item, index) => ({
          filePath: item.tempFilePath,
          name: `附件${this.data.form.attachments.length + index + 1}`,
          type: "order_attachment",
        }));
        this.setData({
          "form.attachments": this.data.form.attachments.concat(files),
        });
      },
    });
  },

  removeAttachment(event) {
    const index = Number(event.currentTarget.dataset.index);
    const nextList = this.data.form.attachments.slice();
    nextList.splice(index, 1);
    this.setData({ "form.attachments": nextList });
  },

  goUserInfo() {
    wx.navigateTo({ url: "/pages/userInfo/userInfo" });
  },

  validateForm() {
    const { form, summary, profile } = this.data;
    if (!business.getProfileCompletion(profile).isComplete) {
      return "请先完善个人资料";
    }
    if (!form.receiverName.trim()) return "请填写收件人姓名";
    if (!business.isPhone(form.contactPhone)) return "请填写正确的手机号";
    if (!form.pickupAddress.trim()) return "请填写取件地址";
    if (!form.deliveryAddress.trim()) return "请填写送达地址";
    if (form.pickupAddress.trim() === form.deliveryAddress.trim()) {
      return "取件地址和送达地址不能相同";
    }
    if (form.pickupTimeType === "scheduled" && !form.pickupTimeValue.trim()) {
      return "请填写预约取件时间";
    }
    if (!form.deliveryBuilding.trim()) return "请填写送达楼栋";
    if (!form.deliveryRoom.trim()) return "请填写宿舍号";
    if (!form.remark.trim()) return "备注信息为必填项";
    if (!summary.total || summary.total < 2) {
      return "总金额异常，请检查";
    }
    if (!form.basePrice || form.basePrice < 2) {
      return "基础悬赏金额不能低于2元";
    }
    return "";
  },

  handleSubmit() {
    const errorMessage = this.validateForm();
    if (errorMessage) {
      wx.showToast({ title: errorMessage, icon: "none" });
      if (errorMessage.includes("个人资料")) {
        setTimeout(() => this.goUserInfo(), 400);
      }
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "发布中", mask: true });

    const payload = Object.assign({}, this.data.form, {
      reward: this.data.summary.total,
    });
    let currentOrderId = "";

    api
      .createTask(payload)
      .then((order) => {
        currentOrderId = order.id;
        wx.hideLoading();
        wx.showLoading({ title: "拉起支付中", mask: true });
        return api.requestEscrowPayment(order.id);
      })
      .then((paymentResult) => {
        wx.hideLoading();
        const message =
          paymentResult && paymentResult.payStatus === "paid"
            ? "发布并支付成功"
            : "支付结果确认中，请到订单页查看";
        wx.showToast({
          title: message,
          icon: paymentResult.payStatus === "paid" ? "success" : "none",
        });
        setTimeout(() => {
          wx.switchTab({ url: "/pages/order/order" });
        }, 500);
      })
      .catch((error) => {
        wx.hideLoading();
        const message = error.message || error.errMsg || "提交失败";
        const isPayCancel =
          error.code === "PAY_CANCEL" || /取消支付|cancel/i.test(message);

        if (currentOrderId && isPayCancel) {
          wx.showModal({
            title: "订单已创建",
            content: "你已取消支付，可前往订单页继续支付。",
            showCancel: false,
            success: () => wx.switchTab({ url: "/pages/order/order" }),
          });
          return;
        }

        wx.showToast({
          title: message,
          icon: "none",
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },
});

const api = require("../../utils/api");
const { resolveOrderListCloudImages } = require("../../utils/cloudImages");
const util = require("../../utils/util");

const MAX_DISTANCE_KM = 5;

const ROLE_LABELS = {
  published: "我发布的",
  accepted: "我接的单",
};

const STATUS_LABELS = {
  pending: "待接单",
  accepted: "待完成",
  delivered: "待完成",
  completed: "已完成",
  cancelled: "已取消",
};

const REFUND_STATUS_LABELS = {
  processing: "退款处理中",
  success: "已退款",
  failed: "退款失败",
  refund_review: "退款审核中",
  refund_pending: "退款待处理",
};

function getRefundStatusText(refundStatus) {
  return REFUND_STATUS_LABELS[refundStatus] || "";
}

function getPayStatusText(item) {
  if (item.refundStatus === "success") return "已退款";
  if (item.refundStatus === "processing") return "退款处理中";
  if (item.refundStatus === "failed") return "退款失败";
  if (item.payStatus === "paid") return "已支付";
  return "待支付";
}

function getPayStatusClass(item) {
  if (item.refundStatus === "success") return "refunded";
  if (item.refundStatus === "processing") return "refunding";
  if (item.refundStatus === "failed") return "refund-failed";
  return item.payStatus === "paid" ? "paid" : "unpaid";
}

function normalizeStatusText(item) {
  return STATUS_LABELS[item.status] || item.statusText || "未知状态";
}

function mapOrderForView(item) {
  const refundStatusText = getRefundStatusText(item.refundStatus);
  const canPay = !!item.canPay && !item.refundStatus;
  const chatTarget =
    item.isMine && item.runner
      ? item.runner
      : !item.isMine && item.publisher
        ? item.publisher
        : null;

  let distanceText = "";
  if (item.distance && item.isRunner) {
    distanceText =
      item.distance > 0 ? `距离您 ${item.distance} 公里` : "距离您过近";
  }

  return Object.assign({}, item, {
    roleText: ROLE_LABELS[item.isMine ? "published" : "accepted"],
    statusText: normalizeStatusText(item),
    payStatusText: getPayStatusText(item),
    payStatusClass: getPayStatusClass(item),
    refundStatusText,
    showRefundStatus: !!refundStatusText,
    canPay,
    canChat: !!(chatTarget && chatTarget.id),
    chatTargetId: chatTarget ? chatTarget.id : "",
    chatTargetName: chatTarget ? chatTarget.nickname : "",
    hasAction: canPay || !!item.canCancel || !!item.canComplete || !!chatTarget,
    rewardSummaryText: `${item.rewardText} · 抽成 ${item.platformFeeText}`,
    runnerText:
      item.runner && item.runner.nickname
        ? `接单者：${item.runner.nickname} · ${
            item.runnerPhoneText || "接单后可见"
          }`
        : "暂时还没有人接单",
    distanceText,
    isOutOfRange: item.distance > MAX_DISTANCE_KM,
  });
}

Page({
  data: {
    initialized: false,
    loading: true,
    activeRole: "published",
    activeStatus: "pending",
    payingOrderId: "",
    userLocation: null, // 用户位置
    roleTabs: [
      { label: "我发布的", value: "published" },
      { label: "我接的单", value: "accepted" },
    ],
    statusTabs: [
      { label: "待接单", value: "pending", count: 0 },
      { label: "待完成", value: "accepted", count: 0 },
      { label: "已完成", value: "completed", count: 0 },
      { label: "已取消", value: "cancelled", count: 0 },
    ],
    counts: {
      published: {
        pending: 0,
        accepted: 0,
        completed: 0,
        cancelled: 0,
      },
      accepted: {
        pending: 0,
        accepted: 0,
        completed: 0,
        cancelled: 0,
      },
    },
    activeCounts: {
      pending: 0,
      accepted: 0,
      completed: 0,
      cancelled: 0,
    },
    rawList: [],
    list: [],
  },

  // 分享给好友：定义本方法后，右上角胶囊菜单才会显示「转发」并支持「复制链接」
  onShareAppMessage() {
    return {
      title: "校园代拿 - 校园跑腿互助平台",
      path: "/pages/order/order",
      imageUrl: ""
    };
  },

  // 分享到朋友圈：定义本方法后，右上角菜单支持「分享到朋友圈」
  onShareTimeline() {
    return {
      title: "校园代拿 - 校园跑腿互助平台",
      query: ""
    };
  },

  onLoad() {
    this.getUserLocation();
  },

  onShow() {
    if (this.data.initialized) {
      this.loadOrders(false);
    }
  },

  onPullDownRefresh() {
    this.loadOrders(false);
  },

  getScopedList(rawList, role, status) {
    const roleFiltered = (rawList || []).filter((item) =>
      role === "published" ? item.isMine : item.isRunner,
    );

    return roleFiltered.filter((item) => {
      if (status === "accepted") {
        return ["accepted", "delivered"].includes(item.status);
      }
      return item.status === status;
    });
  },

  buildCounts(rawList, role) {
    const roleFiltered = (rawList || []).filter((item) =>
      role === "published" ? item.isMine : item.isRunner,
    );

    return {
      pending: roleFiltered.filter((item) => item.status === "pending").length,
      accepted: roleFiltered.filter((item) =>
        ["accepted", "delivered"].includes(item.status),
      ).length,
      completed: roleFiltered.filter((item) => item.status === "completed")
        .length,
      cancelled: roleFiltered.filter((item) => item.status === "cancelled")
        .length,
    };
  },

  applyView() {
    const list = this.getScopedList(
      this.data.rawList,
      this.data.activeRole,
      this.data.activeStatus,
    ).map(mapOrderForView);

    const activeCounts = this.data.counts[this.data.activeRole];
    const statusTabs = this.data.statusTabs.map((item) => ({
      label: item.label,
      value: item.value,
      count: activeCounts[item.value] || 0,
    }));

    this.setData({
      activeCounts,
      statusTabs,
      list,
    });
  },

  loadOrders(showLoading) {
    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    api
      .getOrderList("all")
      .then((data) =>
        resolveOrderListCloudImages(data.list || []).then((list) =>
          Object.assign({}, data, { list }),
        ),
      )
      .then((data) => {
        const counts = {
          published: this.buildCounts(data.list, "published"),
          accepted: this.buildCounts(data.list, "accepted"),
        };

        this.setData({
          initialized: true,
          loading: false,
          rawList: data.list,
          counts,
        });
        this.applyView();
      })
      .catch((error) => {
        this.setData({
          initialized: true,
          loading: false,
        });
        wx.showToast({
          title: error.message || "加载失败",
          icon: "none",
        });
      })
      .finally(() => {
        if (showLoading) {
          wx.hideLoading();
        }
        wx.stopPullDownRefresh();
      });
  },

  switchRole(event) {
    this.setData({
      activeRole: event.currentTarget.dataset.value,
    });
    this.applyView();
  },

  switchStatus(event) {
    this.setData({
      activeStatus: event.currentTarget.dataset.value,
    });
    this.applyView();
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/taskDetail/taskDetail?id=${id}&from=order`,
    });
  },

  handleCancel(event) {
    const id = event.currentTarget.dataset.id;

    wx.showModal({
      title: "取消订单",
      content: "确认取消这个订单吗？已支付订单会发起原路退款。",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        wx.showLoading({ title: "处理中", mask: true });
        api
          .cancelOrder(id)
          .then(() => {
            wx.showToast({
              title: "订单已取消",
              icon: "success",
            });
            this.loadOrders(false);
          })
          .catch((error) => {
            wx.showToast({
              title: error.message || "取消失败",
              icon: "none",
            });
          })
          .finally(() => {
            wx.hideLoading();
          });
      },
    });
  },

  handleComplete(event) {
    const id = event.currentTarget.dataset.id;

    wx.showModal({
      title: "完成订单",
      content: "确认订单已经送达并完成结算吗？",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        wx.showLoading({ title: "处理中", mask: true });
        api
          .completeOrder(id)
          .then(() => {
            wx.showToast({
              title: "订单已完成",
              icon: "success",
            });
            this.loadOrders(false);
          })
          .catch((error) => {
            wx.showToast({
              title: error.message || "操作失败",
              icon: "none",
            });
          })
          .finally(() => {
            wx.hideLoading();
          });
      },
    });
  },

  handlePay(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.payingOrderId) {
      return;
    }

    this.setData({ payingOrderId: id });
    wx.showLoading({ title: "拉起支付中", mask: true });

    api
      .requestEscrowPayment(id)
      .then((result) => {
        const paid = result && result.payStatus === "paid";
        wx.showToast({
          title: paid ? "支付成功" : "支付结果确认中",
          icon: "none",
        });
        this.loadOrders(false);
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "支付失败，请稍后重试",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ payingOrderId: "" });
      });
  },

  openChat(event) {
    const orderId = event.currentTarget.dataset.id;
    const targetUserId = event.currentTarget.dataset.targetUserId;
    const targetUserName = event.currentTarget.dataset.targetUserName || "";

    if (!orderId || !targetUserId) {
      wx.showToast({
        title: "当前暂无可联系对象",
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/chat/detail/detail?orderId=${orderId}&targetUserId=${targetUserId}&targetUserName=${encodeURIComponent(targetUserName)}`,
    });
  },

  goPublish() {
    wx.switchTab({
      url: "/pages/publish/publish",
    });
  },
});

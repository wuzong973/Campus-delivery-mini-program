const api = require("../../utils/api");
const { resolveOrderListCloudImages } = require("../../utils/cloudImages");

Page({
  data: {
    initialized: false,
    loading: true,
    activeRole: "published",
    activeStatus: "pending",
    payingOrderId: "",
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

  onLoad() {
    this.loadOrders(true);
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
    );
    const statusTabs = this.data.statusTabs.map((item) => ({
      label: item.label,
      value: item.value,
      count: this.data.counts[this.data.activeRole][item.value] || 0,
    }));

    this.setData({
      activeCounts: this.data.counts[this.data.activeRole],
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
      content: "确认取消这个订单吗？仅发布者可取消未接单订单。",
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

  handleComplete(event) {
    const id = event.currentTarget.dataset.id;

    wx.showModal({
      title: "完成订单",
      content: "确认订单已拍照送达并完成结算吗？",
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
        wx.hideLoading();
        const paid = result && result.payStatus === "paid";
        wx.showToast({
          title: paid ? "支付成功" : "支付结果确认中",
          icon: paid ? "success" : "none",
        });
        this.loadOrders(false);
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({
          title: error.message || "支付失败，请稍后重试",
          icon: "none",
        });
      })
      .finally(() => {
        this.setData({ payingOrderId: "" });
      });
  },

  goPublish() {
    wx.switchTab({
      url: "/pages/publish/publish",
    });
  },
});

const api = require("../../utils/api");

const POLL_INTERVAL_MS = 5000;
const CHAT_TAB_INDEX = 3;

Page({
  data: {
    initialized: false,
    loading: true,
    totalUnreadCount: 0,
    list: [],
  },

  onLoad() {
    this.loadSessions(true);
  },

  onShow() {
    if (this.data.initialized) {
      this.loadSessions(false);
    }
    this.startPolling();

    if (!this.handleChatUpdated) {
      this.handleChatUpdated = () => this.loadSessions(false);
    }
    getApp().eventBus.on("chatUpdated", this.handleChatUpdated);
  },

  onHide() {
    this.stopPolling();
    if (this.handleChatUpdated) {
      getApp().eventBus.off("chatUpdated", this.handleChatUpdated);
    }
  },

  onUnload() {
    this.stopPolling();
    if (this.handleChatUpdated) {
      getApp().eventBus.off("chatUpdated", this.handleChatUpdated);
    }
  },

  onPullDownRefresh() {
    this.loadSessions(false);
  },

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.loadSessions(false);
    }, POLL_INTERVAL_MS);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  syncTabBadge(totalUnreadCount) {
    const text =
      totalUnreadCount > 99 ? "99+" : String(Number(totalUnreadCount || 0));

    if (totalUnreadCount > 0) {
      wx.setTabBarBadge({
        index: CHAT_TAB_INDEX,
        text,
      });
      return;
    }

    wx.removeTabBarBadge({
      index: CHAT_TAB_INDEX,
    });
  },

  loadSessions(showLoading) {
    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    api
      .getChatSessions()
      .then((data) => {
        const totalUnreadCount = Number(data.totalUnreadCount || 0);
        this.setData({
          initialized: true,
          loading: false,
          totalUnreadCount,
          list: data.list || [],
        });
        this.syncTabBadge(totalUnreadCount);
      })
      .catch((error) => {
        this.setData({
          initialized: true,
          loading: false,
        });
        wx.showToast({
          title: error.message || "加载聊天失败",
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

  openSession(event) {
    const sessionId = event.currentTarget.dataset.sessionId;
    if (!sessionId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/chat/detail/detail?sessionId=${sessionId}`,
    });
  },

  goOrder() {
    wx.switchTab({
      url: "/pages/order/order",
    });
  },
});

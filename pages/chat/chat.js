const api = require("../../utils/api");

const POLL_INTERVAL_MS = 5000;
// 连续失败时的退避上限，避免断网状态下持续高频请求
const POLL_MAX_INTERVAL_MS = 60000;
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

  // 分享给好友：定义本方法后，右上角胶囊菜单才会显示「转发」并支持「复制链接」
  onShareAppMessage() {
    return {
      title: "校园代拿 - 校园跑腿互助平台",
      path: "/pages/chat/chat",
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

  onShow() {
    if (this.data.initialized) {
      // 回到页面时的后台刷新保持静默，失败不打扰用户
      this.loadSessions(false, true);
    }
    this.startPolling();

    if (!this.handleChatUpdated) {
      this.handleChatUpdated = () => this.loadSessions(false, true);
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
    this.polling = true;
    this.pollFailures = 0;
    this.scheduleNextPoll(POLL_INTERVAL_MS);
  },

  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  // 用自调度 setTimeout 代替 setInterval，以便在连续失败时做指数退避
  scheduleNextPoll(delay) {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;

      if (!this.polling) {
        return;
      }

      this.loadSessions(false, true).then((ok) => {
        if (!this.polling) {
          return;
        }

        this.pollFailures = ok ? 0 : (this.pollFailures || 0) + 1;

        const next = Math.min(
          POLL_INTERVAL_MS * Math.pow(2, Math.min(this.pollFailures, 4)),
          POLL_MAX_INTERVAL_MS,
        );

        this.scheduleNextPoll(next);
      });
    }, delay);
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

  /**
   * 拉取会话列表。
   * @param {boolean} showLoading 是否显示全屏 loading
   * @param {boolean} silent 静默模式：失败时不弹 toast。
   *   轮询必须用静默模式 —— 旧实现每 5 秒失败一次就弹一次 toast，
   *   断网时会把屏幕刷满提示，用户完全无法操作。
   * @returns {Promise<boolean>} 是否成功，供轮询退避判断
   */
  loadSessions(showLoading, silent) {
    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    return api
      .getChatSessions()
      .then((data) => {
        const totalUnreadCount = Number(data.totalUnreadCount || 0);
        this.setData({
          initialized: true,
          loading: false,
          totalUnreadCount,
          list: (data && data.list) || [],
        });
        this.syncTabBadge(totalUnreadCount);
        return true;
      })
      .catch((error) => {
        this.setData({
          initialized: true,
          loading: false,
        });

        if (!silent) {
          wx.showToast({
            title: (error && error.message) || "加载聊天失败",
            icon: "none",
          });
        } else {
          console.warn("load chat sessions failed", error);
        }

        return false;
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

const api = require("../../utils/api");

const WATCH_START_DELAY_MS = 320;
const DEV_POLL_INTERVAL_MS = 45000;
const WATCH_RETRY_DELAYS_MS = [2000, 5000, 8000];
const MAX_WATCH_FAILURE_RETRIES = 3;

function shouldPollNotificationsInDev() {
  try {
    const { miniProgram } = wx.getAccountInfoSync();
    return miniProgram.envVersion === "develop";
  } catch (e) {
    return false;
  }
}

function createDefaultMineData() {
  return {
    initialized: false,
    loading: true,
    profile: {
      nickname: "校园同学",
      slogan: "完善资料后，接单和发布都会更高效。",
      phone: "未设置",
      commonAddress: "未设置",
      avatarTheme: "ocean",
      avatarText: "我",
    },
    stats: {
      publishedCount: 0,
      acceptedCount: 0,
      income: "¥0.00",
      spending: "¥0.00",
      processingCount: 0,
      pendingCount: 0,
      availableBalance: "¥0.00",
    },
    publishedTasks: [],
    acceptedTasks: [],
    notifications: [],
    collectionCount: 0,
    unreadCount: 0,
  };
}

Page({
  data: createDefaultMineData(),

  // 分享给好友：定义本方法后，右上角胶囊菜单才会显示「转发」并支持「复制链接」
  onShareAppMessage() {
    return {
      title: "校园代拿 - 校园跑腿互助平台",
      path: "/pages/mine/mine",
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
    this.loadPageData(true);
  },

  onShow() {
    if (this.data.initialized) {
      this._watchFailureRetries = 0;
      this.loadPageData(false);
      this.startNotificationWatch();
    }
  },

  onHide() {
    this.stopNotificationWatch();
  },

  onUnload() {
    this.stopNotificationWatch();
  },

  onPullDownRefresh() {
    this.loadPageData(false);
  },

  loadPageData(showLoading) {
    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    const wasInitialized = this.data.initialized;

    api
      .getMineData()
      .then((data) => {
        const profile = Object.assign(
          {},
          createDefaultMineData().profile,
          data.profile || {},
        );
        const stats = Object.assign(
          {},
          createDefaultMineData().stats,
          data.stats || {},
        );

        this.setData(
          {
            initialized: true,
            loading: false,
            profile,
            stats,
            publishedTasks: data.publishedTasks || [],
            acceptedTasks: data.acceptedTasks || [],
            notifications: data.notifications || [],
            collectionCount: Number(data.collectionCount || 0),
            unreadCount: Number(data.unreadCount || 0),
          },
          () => {
            if (!wasInitialized) {
              this._watchFailureRetries = 0;
              this.startNotificationWatch();
            }
          },
        );
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

  _startDevNotificationPoll() {
    this._notificationPollTimer = setInterval(() => {
      if (this.data.initialized) {
        this.loadPageData(false);
      }
    }, DEV_POLL_INTERVAL_MS);
  },

  _startWatchInner() {
    if (!this.data.initialized || shouldPollNotificationsInDev()) {
      return;
    }

    try {
      if (
        this.notificationWatcher &&
        typeof this.notificationWatcher.close === "function"
      ) {
        this.notificationWatcher.close();
      }
    } catch (e) {
      /* ignore */
    }

    this.notificationWatcher = null;

    api
      .watchMyNotifications(
        () => {
          if (this.data.initialized) {
            this.loadPageData(false);
          }
        },
        () => {
          this.notificationWatcher = null;
          console.warn("notifications watch error");
          this._scheduleWatchRecovery();
        },
      )
      .then((watcher) => {
        this.notificationWatcher = watcher;
        this._watchFailureRetries = 0;
      })
      .catch((error) => {
        console.warn("notifications watch start failed", error);
        this._scheduleWatchRecovery();
      });
  },

  _scheduleWatchRecovery() {
    if (shouldPollNotificationsInDev()) {
      return;
    }

    this._watchFailureRetries = (this._watchFailureRetries || 0) + 1;
    if (this._watchFailureRetries > MAX_WATCH_FAILURE_RETRIES) {
      return;
    }

    const delay = WATCH_RETRY_DELAYS_MS[this._watchFailureRetries - 1] || 8000;

    if (this._watchRecoverTimer) {
      clearTimeout(this._watchRecoverTimer);
    }

    this._watchRecoverTimer = setTimeout(() => {
      this._watchRecoverTimer = null;
      if (!this.data.initialized) {
        return;
      }
      this._startWatchInner();
    }, delay);
  },

  startNotificationWatch() {
    if (!this.data.initialized) {
      return;
    }

    this._watchFailureRetries = 0;

    if (this._watchRecoverTimer) {
      clearTimeout(this._watchRecoverTimer);
      this._watchRecoverTimer = null;
    }

    if (this._watchStartTimer) {
      clearTimeout(this._watchStartTimer);
      this._watchStartTimer = null;
    }

    if (this._notificationPollTimer) {
      clearInterval(this._notificationPollTimer);
      this._notificationPollTimer = null;
    }

    try {
      if (
        this.notificationWatcher &&
        typeof this.notificationWatcher.close === "function"
      ) {
        this.notificationWatcher.close();
      }
    } catch (e) {
      /* ignore */
    }

    this.notificationWatcher = null;

    if (shouldPollNotificationsInDev()) {
      this._startDevNotificationPoll();
      return;
    }

    this._watchStartTimer = setTimeout(() => {
      this._watchStartTimer = null;
      if (!this.data.initialized) {
        return;
      }
      this._startWatchInner();
    }, WATCH_START_DELAY_MS);
  },

  stopNotificationWatch() {
    if (this._watchStartTimer) {
      clearTimeout(this._watchStartTimer);
      this._watchStartTimer = null;
    }

    if (this._watchRecoverTimer) {
      clearTimeout(this._watchRecoverTimer);
      this._watchRecoverTimer = null;
    }

    if (this._notificationPollTimer) {
      clearInterval(this._notificationPollTimer);
      this._notificationPollTimer = null;
    }

    try {
      if (
        this.notificationWatcher &&
        typeof this.notificationWatcher.close === "function"
      ) {
        this.notificationWatcher.close();
      }
    } catch (e) {
      /* ignore */
    }

    this.notificationWatcher = null;
  },

  goUserInfo() {
    wx.navigateTo({
      url: "/pages/userInfo/userInfo",
    });
  },

  goAuth() {
    wx.navigateTo({
      url: "/pages/auth/auth",
    });
  },

  goOrder() {
    wx.switchTab({
      url: "/pages/order/order",
    });
  },

  goPublish() {
    wx.switchTab({
      url: "/pages/publish/publish",
    });
  },

  goWallet() {
    wx.navigateTo({
      url: "/pages/wallet/wallet",
    });
  },

  goAdmin() {
    wx.navigateTo({
      url: "/pages/admin/admin",
    });
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/taskDetail/taskDetail?id=${id}&from=mine`,
    });
  },

  handleSettings() {
    wx.showActionSheet({
      itemList: ["重新同步资料", "进入收益钱包"],
      success: (result) => {
        if (result.tapIndex !== 0) {
          this.goWallet();
          return;
        }

        wx.showLoading({ title: "同步中", mask: true });
        api
          .getCurrentUserProfile()
          .then(() => {
            wx.showToast({
              title: "资料已同步",
              icon: "success",
            });
            this.loadPageData(false);
          })
          .catch((error) => {
            wx.showToast({
              title: error.message || "同步失败",
              icon: "none",
            });
          })
          .finally(() => {
            wx.hideLoading();
          });
      },
    });
  },
});

const auth = require("./utils/auth");
const config = require("./utils/config");
const business = require("./utils/business");

App({
  eventBus: {
    listeners: {},
    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    },
    off(event, callback) {
      if (!this.listeners[event]) {
        return;
      }
      this.listeners[event] = this.listeners[event].filter(
        (l) => l !== callback,
      );
    },
    emit(event, data) {
      if (!this.listeners[event]) {
        return;
      }
      this.listeners[event].forEach((callback) => {
        callback(data);
      });
    },
  },

  onLaunch() {
    auth.initCloud();

    // 会话恢复统一交给 auth 层处理：有本地 token 就先向服务端校验有效性，
    // 失效则自动回退到 wx.login。不再把缓存的 openid 直接送去换 token。
    const loginPromise = auth.ensureLogin();
    this.globalData.readyPromise = loginPromise;

    loginPromise
      .then((result) => {
        this.globalData.user = result.user;
        this.globalData.openid = result.openid;
        this.globalData.runtimeMode = auth.getRuntimeMode();
      })
      .catch((error) => {
        console.error("login bootstrap failed", error);
      });
    this.pollUnreadCount();
  },

  // 回到前台恢复未读轮询
  onShow() {
    this.pollUnreadCount();
  },

  // 退到后台停止轮询，避免长期空转消耗流量与电量
  onHide() {
    this.stopUnreadCountPolling();
  },

  stopUnreadCountPolling() {
    if (this._unreadPollTimer) {
      clearInterval(this._unreadPollTimer);
      this._unreadPollTimer = null;
    }
  },

  pollUnreadCount() {
    const api = require("./utils/api");

    const CHAT_TAB_INDEX = 3;
    const POLL_INTERVAL_MS = 15000;

    const doPoll = () => {
      // 聊天列表页自己会以更高的频率刷新同一个接口，
      // 这里跳过以避免同一接口被两个定时器同时轮询、请求量翻倍。
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current && current.route === "pages/chat/chat") {
        return;
      }

      api
        .getChatSessions()
        .then((data) => {
          const totalUnreadCount = Number(data.totalUnreadCount || 0);
          const text = totalUnreadCount > 99 ? "99+" : String(totalUnreadCount);

          if (totalUnreadCount > 0) {
            wx.setTabBarBadge({
              index: CHAT_TAB_INDEX,
              text,
            });
          } else {
            wx.removeTabBarBadge({
              index: CHAT_TAB_INDEX,
            });
          }
        })
        .catch((err) => {
          // 后台轮询失败保持静默，不要打扰用户
          console.warn("poll unread count failed", err);
        });
    };

    // 重复调用时先清掉旧定时器，防止出现多个并行的轮询
    this.stopUnreadCountPolling();

    doPoll();
    this._unreadPollTimer = setInterval(doPoll, POLL_INTERVAL_MS);
  },

  globalData: {
    readyPromise: null,
    user: null,
    openid: "",
    runtimeMode: "http",
    unreadCount: 0,
    appName: "\u6821\u56ed\u4ee3\u62ff",
    apiBaseUrl: config.apiBaseUrl,
    platformFeeRate: config.platformFeeRate,
    orderTakeLimit: config.runnerTakeLimit,
    typeOptions: business.TYPE_OPTIONS,
    statusOptions: [
      { label: "\u5f85\u63a5\u5355", value: "pending" },
      { label: "\u5f85\u5b8c\u6210", value: "accepted" },
      { label: "\u5df2\u5b8c\u6210", value: "completed" },
      { label: "\u5df2\u53d6\u6d88", value: "cancelled" },
    ],
    avatarThemes: [
      { label: "\u6d77\u76d0\u84dd", value: "ocean" },
      { label: "\u9752\u8349\u7eff", value: "mint" },
      { label: "\u6674\u7a7a\u84dd", value: "sky" },
      { label: "\u65e5\u5149\u6a59", value: "sun" },
    ],
  },
});

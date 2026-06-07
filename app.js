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
    const cachedOpenid = auth.getOpenId();
    const loginPromise = auth.login(false, null, cachedOpenid);
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

  pollUnreadCount() {
    const api = require("./utils/api");

    const CHAT_TAB_INDEX = 3;
    const POLL_INTERVAL_MS = 15000;

    const doPoll = () => {
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
          console.error("poll unread count failed", err);
        });
    };

    setInterval(doPoll, POLL_INTERVAL_MS);
    doPoll();
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

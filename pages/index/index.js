const api = require("../../utils/api");

function createDefaultHomeData() {
  return {
    initialized: false,
    loading: true,
    currentUser: {
      nickname: "同学",
      avatarTheme: "ocean",
      avatarText: "我",
    },
    banners: [],
    notices: [],
    priceReference: [],
    hotAreas: [],
    hotRunners: [],
    guides: [],
    summary: {
      pendingTasks: 0,
      completedTasks: 0,
      runnerCount: 0,
    },
  };
}

Page({
  data: createDefaultHomeData(),

  onLoad() {
    this.loadPageData(true);
  },

  onShow() {
    if (this.data.initialized) {
      return;
    }
  },

  onPullDownRefresh() {
    this.loadPageData(false);
  },

  loadPageData(showLoading) {
    const app = getApp();

    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    app.globalData.readyPromise
      .then(() => api.getHomeData())
      .then((data) => {
        this.setData({
          initialized: true,
          loading: false,
          currentUser: Object.assign(
            {
              nickname: "同学",
              avatarTheme: "ocean",
              avatarText: "我",
            },
            data.currentUser || {},
          ),
          banners: data.banners || [],
          notices: data.notices || [],
          priceReference: data.priceReference || [],
          hotAreas: data.hotAreas || [],
          hotRunners: data.hotRunners || [],
          guides: data.guides || [],
          summary: Object.assign(
            {
              pendingTasks: 0,
              completedTasks: 0,
              runnerCount: 0,
            },
            data.summary || {},
          ),
        });
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

  goPublish() {
    wx.switchTab({
      url: "/pages/publish/publish",
    });
  },

  goTaskList() {
    wx.navigateTo({
      url: "/pages/taskList/taskList",
    });
  },

  goOrder() {
    wx.switchTab({
      url: "/pages/order/order",
    });
  },

  goMine() {
    wx.switchTab({
      url: "/pages/mine/mine",
    });
  },
});

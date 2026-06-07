const api = require('../../utils/api');

Page({
  data: {
    initialized: false,
    loading: true,
    total: 0,
    rawList: [],
    list: [],
    currentLocation: null,
    filters: {
      area: 'all',
      type: 'all',
      price: 'all'
    },
    filterOptions: {
      areas: [{ label: '全部区域', value: 'all' }],
      types: [
        { label: '全部类型', value: 'all' },
        { label: '外卖', value: 'takeout' },
        { label: '快递', value: 'parcel' },
        { label: '帮买', value: 'helpBuy' },
        { label: '文件', value: 'document' },
        { label: '其他', value: 'other' }
      ],
      prices: [
        { label: '全部价格', value: 'all' },
        { label: '1-3元', value: '1-3' },
        { label: '3-5元', value: '3-5' },
        { label: '5元以上', value: '5+' }
      ]
    }
  },

  // 分享给好友：定义本方法后，右上角胶囊菜单才会显示「转发」并支持「复制链接」
  onShareAppMessage() {
    return {
      title: "校园代拿 - 来看看有哪些代拿任务",
      path: "/pages/taskList/taskList",
      imageUrl: ""
    };
  },

  // 分享到朋友圈：定义本方法后，右上角菜单支持「分享到朋友圈」
  onShareTimeline() {
    return {
      title: "校园代拿 - 来看看有哪些代拿任务",
      query: ""
    };
  },

  onLoad() {
    this.loadTasks(true);
  },

  onShow() {
    if (this.data.initialized) {
      this.loadTasks(false);
    }
  },

  onPullDownRefresh() {
    this.loadTasks(false);
  },

  getUserLocation() {
    return new Promise(resolve => {
      wx.getLocation({
        type: 'gcj02',
        success: result => {
          resolve({
            latitude: result.latitude,
            longitude: result.longitude
          });
        },
        fail: () => resolve(null)
      });
    });
  },

  applyFilters(rawList) {
    const { filters } = this.data;
    const filtered = (rawList || []).filter(item => {
      if (filters.area !== 'all' && item.campusAreaText !== filters.area) {
        return false;
      }
      if (filters.type !== 'all' && item.type !== filters.type) {
        return false;
      }
      if (filters.price === '1-3') {
        return item.rewardAmount >= 1 && item.rewardAmount < 3;
      }
      if (filters.price === '3-5') {
        return item.rewardAmount >= 3 && item.rewardAmount < 5;
      }
      if (filters.price === '5+') {
        return item.rewardAmount >= 5;
      }
      return true;
    });

    this.setData({
      total: filtered.length,
      list: filtered
    });
  },

  loadTasks(showLoading) {
    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    this.getUserLocation().then(currentLocation => {
      this.setData({ currentLocation });
      return api.getTaskList({ currentLocation });
    }).then(data => {
      const areas = [{ label: '全部区域', value: 'all' }].concat(
        data.list.reduce((result, item) => {
          if (!result.find(area => area.value === item.campusAreaText)) {
            result.push({
              label: item.campusAreaText,
              value: item.campusAreaText
            });
          }
          return result;
        }, [])
      );

      this.setData({
        initialized: true,
        loading: false,
        rawList: data.list,
        filterOptions: Object.assign({}, this.data.filterOptions, {
          areas
        })
      });
      this.applyFilters(data.list);
    }).catch(error => {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none'
      });
    }).finally(() => {
      if (showLoading) {
        wx.hideLoading();
      }
      wx.stopPullDownRefresh();
    });
  },

  switchFilter(event) {
    const group = event.currentTarget.dataset.group;
    const value = event.currentTarget.dataset.value;
    const nextFilters = Object.assign({}, this.data.filters, {
      [group]: value
    });

    this.setData({
      filters: nextFilters
    });
    this.applyFilters(this.data.rawList);
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/taskDetail/taskDetail?id=' + id + '&from=taskList'
    });
  },

  goPublish() {
    wx.switchTab({
      url: '/pages/publish/publish'
    });
  }
});

const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    submitting: false,
    isAgreed: false,
    profile: {
      nickname: '',
      phone: '',
      profileComplete: false
    }
  },

  onLoad() {
    this.loadProfile();
  },

  onShow() {
    if (!this.data.loading) {
      this.loadProfile();
    }
  },

  loadProfile() {
    wx.showLoading({ title: '加载中' });

    api.getCurrentUserProfile().then(profile => {
      this.setData({
        loading: false,
        profile
      });
    }).catch(error => {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none'
      });
    }).finally(() => {
      wx.hideLoading();
    });
  },

  handleAgreeChange(e) {
    this.setData({
      isAgreed: e.detail.value.includes('agree')
    });
  },

  openPrivacyContract() {
    wx.openPrivacyContract({
      success: () => {},
      fail: () => {
        wx.showToast({
          title: '打开隐私协议失败',
          icon: 'none'
        });
      }
    });
  },

  handleWechatLogin() {
    if (this.data.submitting) {
      return;
    }

    if (!this.data.isAgreed) {
      wx.showToast({
        title: '请先阅读并同意用户隐私政策',
        icon: 'none'
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '登录中' });

    wx.getUserProfile({
      desc: '用于完善会员资料',
      success: (res) => {
        api.refreshLogin(res.userInfo).then(() => {
          wx.showToast({
            title: '登录成功',
            icon: 'success'
          });
          this.loadProfile();
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/index/index' });
          }, 500);
        }).catch(error => {
          wx.showToast({
            title: error.message || '登录失败',
            icon: 'none'
          });
        }).finally(() => {
          this.setData({ submitting: false });
          wx.hideLoading();
        });
      },
      fail: () => {
        this.setData({ submitting: false });
        wx.hideLoading();
        wx.showToast({
          title: '您取消了授权',
          icon: 'none'
        });
      }
    });
  },

  goUserInfo() {
    wx.navigateTo({
      url: '/pages/userInfo/userInfo'
    });
  },

  goHome() {
    wx.reLaunch({
      url: '/pages/index/index'
    });
  }
});

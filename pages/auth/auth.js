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

  // 完成登录：userInfo 允许为空（登录本身只依赖 openid，头像昵称可在「个人资料」页补充）
  finishLogin(userInfo, tip) {
    api.refreshLogin(userInfo).then(() => {
      wx.showToast({
        title: tip || '登录成功',
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

    // 不再调用 wx.getUserProfile：
    // 该接口自 2022-10 起只返回「微信用户」这类匿名昵称与默认头像，
    // 弹出的授权框已无实际收益，反而多一次打扰。
    // 登录本身只依赖 openid；头像与昵称由「个人资料」页的
    // open-type="chooseAvatar" + 昵称输入框采集。
    this.finishLogin(null, '登录成功，请完善资料');
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

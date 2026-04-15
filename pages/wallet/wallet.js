const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    submitting: false,
    wallet: {
      balanceText: '￥0.00',
      totalIncomeText: '￥0.00',
      totalWithdrawnText: '￥0.00',
      pendingWithdrawText: '￥0.00',
      takeLimitTip: ''
    },
    amount: ''
  },

  onLoad() {
    this.loadWallet(true);
  },

  onShow() {
    if (!this.data.loading) {
      this.loadWallet(false);
    }
  },

  onPullDownRefresh() {
    this.loadWallet(false);
  },

  loadWallet(showLoading) {
    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    api.getWalletData().then(wallet => {
      this.setData({
        loading: false,
        wallet
      });
    }).catch(error => {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none'
      });
    }).finally(() => {
      wx.hideLoading();
      wx.stopPullDownRefresh();
    });
  },

  handleInput(event) {
    this.setData({
      amount: event.detail.value
    });
  },

  submitWithdraw() {
    if (!this.data.amount || Number(this.data.amount) <= 0) {
      wx.showToast({
        title: '请输入正确的提现金额',
        icon: 'none'
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });

    api.createWithdrawal(this.data.amount).then(() => {
      wx.showToast({
        title: '提现申请已提交',
        icon: 'success'
      });
      this.setData({
        amount: ''
      });
      this.loadWallet(false);
    }).catch(error => {
      wx.showToast({
        title: error.message || '提交失败',
        icon: 'none'
      });
    }).finally(() => {
      this.setData({ submitting: false });
      wx.hideLoading();
    });
  }
});

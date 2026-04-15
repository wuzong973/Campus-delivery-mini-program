const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    dashboard: {
      summary: {
        userCount: 0,
        orderCount: 0,
        totalVolumeText: '￥0.00',
        platformIncomeText: '￥0.00',
        pendingWithdrawals: 0
      },
      users: [],
      orders: [],
      abnormalLogs: [],
      withdrawals: []
    }
  },

  onLoad() {
    this.loadDashboard(true);
  },

  onShow() {
    if (!this.data.loading) {
      this.loadDashboard(false);
    }
  },

  onPullDownRefresh() {
    this.loadDashboard(false);
  },

  loadDashboard(showLoading) {
    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    api.getAdminDashboard().then(dashboard => {
      this.setData({
        loading: false,
        dashboard
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

  auditWithdrawal(event) {
    const id = event.currentTarget.dataset.id;
    const decision = event.currentTarget.dataset.decision;
    const confirmText = decision === 'approve' ? '确认通过该提现申请吗？' : '确认驳回该提现申请并退回余额吗？';

    wx.showModal({
      title: '提现审核',
      content: confirmText,
      success: result => {
        if (!result.confirm) {
          return;
        }

        wx.showLoading({ title: '处理中' });
        api.auditWithdrawal(id, decision).then(() => {
          wx.showToast({
            title: decision === 'approve' ? '已通过' : '已驳回',
            icon: 'success'
          });
          this.loadDashboard(false);
        }).catch(error => {
          wx.showToast({
            title: error.message || '处理失败',
            icon: 'none'
          });
        }).finally(() => {
          wx.hideLoading();
        });
      }
    });
  }
});

const api = require('../../utils/api');
const util = require("../../utils/util");

// 后端返回的是英文枚举，直接渲染可读性差，这里统一转成中文文案
const ORDER_STATUS_TEXT = {
  pending: '待接单',
  accepted: '待送达',
  delivered: '待完成',
  completed: '已完成',
  cancelled: '已取消'
};

const PAY_STATUS_TEXT = {
  unpaid: '待支付',
  paid: '已支付',
  refund_pending: '待退款',
  refund_review: '退款审核中'
};

const WITHDRAW_STATUS_TEXT = {
  pending: '审核中',
  paid: '已打款',
  approved: '已通过',
  rejected: '已驳回',
  failed: '打款失败'
};

const ROLE_TEXT = {
  admin: '管理员',
  user: '普通用户'
};

const ABNORMAL_TYPE_TEXT = {
  order_frequency: '下单频率异常',
  take_frequency: '接单频率异常',
  cancel_frequency: '取消频率异常',
  withdraw_frequency: '提现频率异常'
};

function decorateDashboard(dashboard) {
  const data = dashboard || {};

  return Object.assign({}, data, {
    users: (data.users || []).map(item => Object.assign({}, item, {
      roleText: ROLE_TEXT[item.role] || item.role || '未知角色'
    })),
    orders: (data.orders || []).map(item => Object.assign({}, item, {
      statusText: ORDER_STATUS_TEXT[item.status] || item.status || '未知状态',
      payStatusText: PAY_STATUS_TEXT[item.payStatus] || item.payStatus || '未知',
      campusAreaText: item.campusAreaText || '未标注区域'
    })),
    withdrawals: (data.withdrawals || []).map(item => Object.assign({}, item, {
      statusText: WITHDRAW_STATUS_TEXT[item.status] || item.status || '未知状态'
    })),
    abnormalLogs: (data.abnormalLogs || []).map(item => Object.assign({}, item, {
      typeText: ABNORMAL_TYPE_TEXT[item.type] || item.type || '其他异常'
    }))
  });
}

Page({
  data: {
    loading: true,
    dashboard: {
      summary: {
        userCount: 0,
        orderCount: 0,
        totalVolumeText: '￥0.00',
        platformIncomeText: '￥0.00',
        totalRunnerIncomeText: '￥0.00',
        pendingWithdrawals: 0
      },
      users: [],
      orders: [],
      abnormalLogs: [],
      withdrawals: []
    }
  },

  onLoad() {
    // onShow 的全量刷新做节流：快速来回切 tab 时不必每次都打一遍完整请求
    this.shouldRefreshOnShow = util.createRefreshThrottle();
    this.loadDashboard(true);
  },

  onShow() {
    if (this.data.loading || !this.shouldRefreshOnShow()) {
      return;
    }

    this.loadDashboard(false);
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
        dashboard: decorateDashboard(dashboard)
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

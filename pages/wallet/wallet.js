const api = require('../../utils/api');
const util = require("../../utils/util");
const subscribe = require('../../utils/subscribe');

// 提现状态中文映射：后端返回 pending / paid / rejected 等原始值，
// 直接渲染会展示英文状态，这里统一转为可读文案与样式类。
const WITHDRAW_STATUS_TEXT = {
  pending: '审核中',
  paid: '已打款',
  approved: '已通过',
  rejected: '已驳回',
  failed: '打款失败'
};

function decorateWithdrawals(list) {
  return (list || []).map(item => Object.assign({}, item, {
    statusText: WITHDRAW_STATUS_TEXT[item.status] || item.status || '未知状态'
  }));
}

Page({
  data: {
    loading: true,
    submitting: false,
    wallet: {
      balanceText: '￥0.00',
      totalIncomeText: '￥0.00',
      totalWithdrawnText: '￥0.00',
      pendingWithdrawText: '￥0.00',
      takeLimitTip: '',
      withdrawals: []
    },
    amount: ''
  },

  // 分享给好友：定义本方法后，右上角胶囊菜单才会显示「转发」并支持「复制链接」
  onShareAppMessage() {
    return {
      title: "校园代拿 - 校园跑腿互助平台",
      path: "/pages/wallet/wallet",
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
    // onShow 的全量刷新做节流：快速来回切 tab 时不必每次都打一遍完整请求
    this.shouldRefreshOnShow = util.createRefreshThrottle();
    this.loadWallet(true);
  },

  onShow() {
    if (this.data.loading || !this.shouldRefreshOnShow()) {
      return;
    }

    this.loadWallet(false);
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
        wallet: Object.assign({}, wallet, {
          withdrawals: decorateWithdrawals(wallet && wallet.withdrawals)
        })
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

  // 提现按钮入口（bindtap）
  // 集成一次性订阅消息：在用户点击「提现」时同步唤起「提现成功通知」授权弹窗。
  // 微信规则：requestSubscribeMessage 必须由用户点击事件同步触发，故放在校验后、请求前。
  // 无论同意/拒绝都不阻断提现业务。
  submitWithdraw() {
    // 金额校验：Number("abc") 是 NaN，而 NaN <= 0 为 false，
    // 旧实现用 `Number(amount) <= 0` 会让非数字输入直接穿过校验。
    const raw = String(this.data.amount == null ? "" : this.data.amount).trim();
    const amount = Number(raw);
    const available = Number(
      String(this.data.wallet.balanceText || "").replace(/[^\d.]/g, ""),
    );

    if (!raw) {
      wx.showToast({
        title: "请输入提现金额",
        icon: "none"
      });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({
        title: "请输入正确的提现金额",
        icon: "none"
      });
      return;
    }

    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      wx.showToast({
        title: "金额最多保留两位小数",
        icon: "none"
      });
      return;
    }

    if (Number.isFinite(available) && available > 0 && amount > available) {
      wx.showToast({
        title: "提现金额不能超过可提现余额",
        icon: "none"
      });
      return;
    }

    // 唤起一次性订阅消息授权（提现成功通知）
    subscribe.requestSubscribe("withdrawSuccess").then((subscribeResult) => {
      // subscribeResult.status: 'accept' | 'reject' | 'ban' | 'unsupported' | 'fail'
      // 同意/拒绝回调判断：不阻断业务；实际项目可在此把授权结果上报后端
      if (subscribeResult.status === "accept") {
        console.log("[订阅] 用户同意提现成功通知", subscribeResult.accepted);
      } else {
        console.log("[订阅] 用户未同意提现成功通知", subscribeResult.status);
      }

      // 以下为原有提现业务流程（逻辑保持不变）
      this.setData({ submitting: true });
      wx.showLoading({ title: "提交中" });

      api
        .createWithdrawal(amount)
        .then(() => {
          wx.showToast({
            title: "提现申请已提交",
            icon: "success"
          });
          this.setData({
            amount: ""
          });
          this.loadWallet(false);
        })
        .catch((error) => {
          wx.showToast({
            title: error.message || "提交失败",
            icon: "none"
          });
        })
        .finally(() => {
          this.setData({ submitting: false });
          wx.hideLoading();
        });
    }); // 结束 subscribe.requestSubscribe
  },
});

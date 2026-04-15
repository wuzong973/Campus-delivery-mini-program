const auth = require('./utils/auth');
const config = require('./utils/config');
const business = require('./utils/business');

App({
  onLaunch() {
    auth.initCloud();
    const loginPromise = auth.login();
    this.globalData.readyPromise = loginPromise;

    loginPromise.then(result => {
      this.globalData.user = result.user;
      this.globalData.openid = result.openid;
      this.globalData.runtimeMode = auth.getRuntimeMode();
    }).catch(error => {
      console.error('login bootstrap failed', error);
    });
  },

  globalData: {
    readyPromise: null,
    user: null,
    openid: '',
    runtimeMode: 'cloud',
    unreadCount: 0,
    appName: '\u6821\u56ed\u4ee3\u62ff',
    platformFeeRate: config.platformFeeRate,
    orderTakeLimit: config.runnerTakeLimit,
    typeOptions: business.TYPE_OPTIONS,
    statusOptions: [
      { label: '\u5f85\u63a5\u5355', value: 'pending' },
      { label: '\u5f85\u5b8c\u6210', value: 'accepted' },
      { label: '\u5df2\u5b8c\u6210', value: 'completed' },
      { label: '\u5df2\u53d6\u6d88', value: 'cancelled' }
    ],
    avatarThemes: [
      { label: '\u6d77\u76d0\u84dd', value: 'ocean' },
      { label: '\u9752\u8349\u7eff', value: 'mint' },
      { label: '\u6674\u7a7a\u84dd', value: 'sky' },
      { label: '\u65e5\u5149\u6a59', value: 'sun' }
    ]
  }
});

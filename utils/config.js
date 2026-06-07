module.exports = {
  appId: "YOUR_WECHAT_APP_ID",
  apiBaseUrl: "https://YOUR_API_HOST/api",
  uploadBaseUrl: "https://YOUR_API_HOST/uploads",
  paymentNotifyUrl: "https://YOUR_API_HOST/pay_notify.php",
  platformFeeRate: 0.01,
  runnerTakeLimit: 3,
  platformName: "校园代拿",
  paymentPollingInterval: 1500,
  paymentPollingAttempts: 8,
  paymentEnabled: true,
  paymentConfig: {
    mchId: "YOUR_MERCHANT_ID",
    publicKeyId: "PUB_KEY_ID_01YOUR_MERCHANT_ID2026040900111545002400",
    serialNo: "YOUR_CERTIFICATE_SERIAL",
  },
};

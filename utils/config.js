// 小程序端运行时配置。
//
// 注意：这里只保留前端真正会用到的字段。
// 商户号（mchId）、证书序列号（serialNo）、公钥 ID 等支付相关标识已移除 ——
// 它们属于服务端配置，不应随小程序包分发（代码包可被反编译）。
// 支付参数由后端在 /orders/:id/pay 中按需下发。
module.exports = {
  appId: "wx4f4f74eaf4b7d100",
  apiBaseUrl: "https://wzl136122.cn/api",
  uploadBaseUrl: "https://wzl136122.cn/uploads",
  platformFeeRate: 0.01,
  runnerTakeLimit: 3,
  paymentPollingInterval: 1500,
  paymentPollingAttempts: 8,
};

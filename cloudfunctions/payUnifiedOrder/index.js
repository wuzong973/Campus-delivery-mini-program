const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const DEFAULT_NOTIFY_URL =
  "https://wzl136122.cn/pay_notify.php";

function getPayConfig() {
  return {
    appId: process.env.WECHAT_PAY_APP_ID || process.env.APPID || "wx4f4f74eaf4b7d100",
    mchId: process.env.WECHAT_PAY_MCH_ID || process.env.MCHID || "1110927390",
    apiV2Key: process.env.WECHAT_PAY_API_V2_KEY || process.env.API_KEY_V2 || "96c9fb2d7d81b204b368326eefce3dbd",
    notifyUrl:
      process.env.WECHAT_PAY_NOTIFY_URL ||
      process.env.NOTIFY_URL ||
      DEFAULT_NOTIFY_URL,
  };
}

function ensurePayConfig() {
  const config = getPayConfig();
  const missing = [];

  if (!config.appId) missing.push("WECHAT_PAY_APP_ID");
  if (!config.mchId) missing.push("WECHAT_PAY_MCH_ID");
  if (!config.apiV2Key) missing.push("WECHAT_PAY_API_V2_KEY");
  if (!config.notifyUrl) missing.push("WECHAT_PAY_NOTIFY_URL");

  if (missing.length) {
    throw new Error(`支付配置缺失: ${missing.join(", ")}`);
  }

  return config;
}

function normalizePayArgs(source) {
  if (!source) {
    return null;
  }

  const candidate =
    source.payArgs ||
    source.payment ||
    source.paymentArgs ||
    source.jsapi ||
    source;

  const timeStamp = String(candidate.timeStamp || candidate.timestamp || "");
  const nonceStr = candidate.nonceStr || "";
  const packageValue = candidate.package || "";
  const signType = candidate.signType || "MD5";
  const paySign = candidate.paySign || "";

  if (!timeStamp || !nonceStr || !packageValue || !paySign) {
    return null;
  }

  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType,
    paySign,
  };
}

function getPrepayId(source, payArgs) {
  if (!source && !payArgs) {
    return "";
  }

  if (source.prepayId) return source.prepayId;
  if (source.prepay_id) return source.prepay_id;

  const packageValue = payArgs && payArgs.package ? payArgs.package : "";
  const match = /prepay_id=([^&]+)/.exec(packageValue);

  return match ? match[1] : "";
}

async function loadOrder(orderId) {
  const result = await db.collection("orders").doc(orderId).get();
  return result.data;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;
  const { orderId } = event;
  const payConfig = ensurePayConfig();

  if (!orderId) {
    throw new Error("缺少订单ID");
  }

  const order = await loadOrder(orderId);

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.publisherOpenId !== openid) {
    throw new Error("只能为自己的订单付款");
  }

  if (order.payStatus === "paid") {
    throw new Error("订单已支付，无需重复发起");
  }

  const params = {
    appid: payConfig.appId,
    mch_id: payConfig.mchId,
    body: `校园代拿订单-${order.type || "other"}`,
    out_trade_no: order.outTradeNo,
    total_fee: Math.round(Number(order.rewardAmount || 0) * 100),
    spbill_create_ip: wxContext.CLIENTIP || "127.0.0.1",
    notify_url: payConfig.notifyUrl,
    trade_type: "JSAPI",
    openid,
  };

  try {
    const result = await cloud.cloudPay.unifiedOrder(params);
    const payArgs = normalizePayArgs(result);

    if (!payArgs) {
      throw new Error("统一下单成功但未返回有效支付参数");
    }

    return {
      prepayId: getPrepayId(result, payArgs),
      payArgs,
      raw: result,
    };
  } catch (error) {
    await db.collection("payment_logs").add({
      data: {
        type: "unified_order_fail",
        orderId,
        outTradeNo: order.outTradeNo || "",
        requestPayload: params,
        responsePayload: {
          message: error.message,
        },
        status: "failed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    throw new Error(`微信统一下单失败: ${error.message}`);
  }
};

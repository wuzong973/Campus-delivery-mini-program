const cloud = require("wx-server-sdk");
const Payment = require("tenpay");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function buildTenpayConfig() {
  const appid = process.env.WECHAT_PAY_APP_ID || process.env.APPID || "wx4f4f74eaf4b7d100";
  const mchid = process.env.WECHAT_PAY_MCH_ID || process.env.MCHID || "1110927390";
  const partnerKey =
    process.env.WECHAT_PAY_API_V2_KEY || process.env.API_KEY_V2 || "96c9fb2d7d81b204b368326eefce3dbd";
  const notify_url =
    process.env.WECHAT_PAY_NOTIFY_URL || process.env.NOTIFY_URL || "https://wzl136122.cn/pay_notify.php";

  if (!appid || !mchid || !partnerKey || !notify_url) {
    throw new Error(
      "微信支付配置缺失，请在云函数环境变量中设置 WECHAT_PAY_APP_ID、WECHAT_PAY_MCH_ID、WECHAT_PAY_API_V2_KEY、WECHAT_PAY_NOTIFY_URL",
    );
  }

  return { appid, mchid, partnerKey, notify_url };
}

let paymentClient = null;

function getPaymentClient() {
  if (!paymentClient) {
    paymentClient = new Payment(buildTenpayConfig());
  }
  return paymentClient;
}

async function unifiedOrder(event) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { orderId } = event;

  if (!openid) {
    return { success: false, message: "用户未登录" };
  }

  if (!orderId) {
    return { success: false, message: "缺少订单ID" };
  }

  const orderRes = await db.collection("orders").doc(orderId).get();
  const order = orderRes.data;

  if (!order) {
    return { success: false, message: "订单不存在" };
  }

  const orderParams = {
    out_trade_no: orderId,
    body: `校园代拿-${order.type === "takeout" ? "外卖" : "快递"}`,
    total_fee: Math.round(order.rewardAmount * 100),
    openid,
    trade_type: "JSAPI",
    spbill_create_ip: "127.0.0.1",
  };

  try {
    const payArgs = await getPaymentClient().getPayParams(orderParams);
    return { success: true, data: payArgs };
  } catch (error) {
    console.error("统一下单失败:", error);
    return { success: false, message: "调用微信支付失败" };
  }
}

exports.main = async (event) => {
  switch (event.action) {
    case "unifiedOrder":
      return unifiedOrder(event);
    default:
      return { success: false, message: "不支持的操作" };
  }
};

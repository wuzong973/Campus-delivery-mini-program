const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function getApiV2Key() {
  return process.env.WECHAT_PAY_API_V2_KEY || process.env.API_KEY_V2 || "";
}

function parseXml(xml) {
  const text = String(xml || "");
  const result = {};
  const pattern = /<(\w+)>(?:<!\[CDATA\[(.*?)\]\]>|([^<]*))<\/\1>/g;
  let match = pattern.exec(text);

  while (match) {
    result[match[1]] = match[2] !== undefined ? match[2] : match[3];
    match = pattern.exec(text);
  }

  return result;
}

function buildXmlResponse(returnCode, returnMsg) {
  return `<xml><return_code><![CDATA[${returnCode}]]></return_code><return_msg><![CDATA[${returnMsg}]]></return_msg></xml>`;
}

function verifySign(data) {
  const apiV2Key = getApiV2Key();
  if (!apiV2Key) {
    throw new Error("支付回调验签配置缺失");
  }

  const sign = data.sign;
  const payload = Object.assign({}, data);
  delete payload.sign;

  const signStr =
    Object.keys(payload)
      .filter((key) => payload[key] !== undefined && payload[key] !== "")
      .sort()
      .map((key) => `${key}=${payload[key]}`)
      .join("&") + `&key=${apiV2Key}`;

  const calculatedSign = crypto
    .createHash("md5")
    .update(signStr)
    .digest("hex")
    .toUpperCase();

  return sign === calculatedSign;
}

async function addPaymentLog(type, payload) {
  await db.collection("payment_logs").add({
    data: Object.assign(
      {
        type,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      payload || {},
    ),
  });
}

async function createNotification(userOpenId, title, content, type, orderId) {
  await db.collection("notifications").add({
    data: {
      userOpenId,
      title,
      content,
      type: type || "system",
      orderId: orderId || "",
      read: false,
      createdAt: Date.now(),
    },
  });
}

async function findOrderByTradeNo(outTradeNo) {
  const result = await db
    .collection("orders")
    .where({
      outTradeNo,
    })
    .limit(1)
    .get();

  return result.data[0] || null;
}

async function handlePaidOrder(order, notifyData) {
  if (order.payStatus === "paid") {
    await addPaymentLog("pay_notify_repeat", {
      orderId: order._id,
      outTradeNo: order.outTradeNo,
      transactionId: notifyData.transaction_id || "",
      notifyRaw: notifyData,
      status: "repeat_success",
    });
    return;
  }

  const now = Date.now();

  await db.collection("orders").doc(order._id).update({
    data: {
      payStatus: "paid",
      paymentMode: "wechat_notify",
      transactionId: notifyData.transaction_id || "",
      paidAt: now,
      updatedAt: now,
    },
  });

  await addPaymentLog("pay_notify_success", {
    orderId: order._id,
    outTradeNo: order.outTradeNo,
    transactionId: notifyData.transaction_id || "",
    notifyRaw: notifyData,
    status: "paid",
    tradeState: notifyData.result_code || "SUCCESS",
  });

  await createNotification(
    order.publisherOpenId,
    "支付成功",
    "你的订单已支付成功并进入待接单列表。",
    "payment",
    order._id,
  );
}

exports.main = async (event) => {
  const xmlBody = event && event.body ? event.body : "";
  const notifyData = parseXml(xmlBody);

  try {
    if (!notifyData.return_code || !notifyData.out_trade_no) {
      await addPaymentLog("pay_notify_invalid", {
        notifyRaw: xmlBody,
        status: "invalid",
        failReason: "回调内容不完整",
      });
      return buildXmlResponse("FAIL", "invalid body");
    }

    if (notifyData.return_code !== "SUCCESS") {
      await addPaymentLog("pay_notify_comm_fail", {
        outTradeNo: notifyData.out_trade_no || "",
        notifyRaw: notifyData,
        status: "ignored",
        tradeState: notifyData.return_code,
      });
      return buildXmlResponse("SUCCESS", "OK");
    }

    if (!verifySign(notifyData)) {
      await addPaymentLog("pay_notify_sign_fail", {
        outTradeNo: notifyData.out_trade_no || "",
        notifyRaw: notifyData,
        status: "failed",
        failReason: "签名校验失败",
      });
      return buildXmlResponse("FAIL", "sign error");
    }

    const order = await findOrderByTradeNo(notifyData.out_trade_no);

    if (!order) {
      await addPaymentLog("pay_notify_order_missing", {
        outTradeNo: notifyData.out_trade_no || "",
        transactionId: notifyData.transaction_id || "",
        notifyRaw: notifyData,
        status: "failed",
        failReason: "订单不存在",
      });
      return buildXmlResponse("FAIL", "order missing");
    }

    if (notifyData.result_code === "SUCCESS") {
      await handlePaidOrder(order, notifyData);
      return buildXmlResponse("SUCCESS", "OK");
    }

    await addPaymentLog("pay_notify_business_fail", {
      orderId: order._id,
      outTradeNo: order.outTradeNo,
      transactionId: notifyData.transaction_id || "",
      notifyRaw: notifyData,
      status: "failed",
      tradeState: notifyData.result_code || "",
      failReason: notifyData.err_code_des || "支付失败",
    });
    return buildXmlResponse("SUCCESS", "OK");
  } catch (error) {
    await addPaymentLog("pay_notify_exception", {
      outTradeNo: notifyData.out_trade_no || "",
      notifyRaw: notifyData || xmlBody,
      status: "failed",
      failReason: error.message,
    });
    return buildXmlResponse("FAIL", "server error");
  }
};

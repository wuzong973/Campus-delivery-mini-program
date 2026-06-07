const { publicBaseUrl } = require("../config/env");
const {
  createJsapiPrepay,
  queryTransactionByOutTradeNo,
  queryRefundByOutRefundNo,
  buildMiniProgramPayArgs,
  verifyCallbackSignature,
  decryptCallbackResource,
  createRefund,
} = require("../config/wechatPay");
const {
  now,
  roundMoney,
  createTradeNo,
  createNotification,
  recordAbnormal,
  Order,
  PaymentLog,
} = require("./shared");

async function addPaymentLog(type, payload) {
  return PaymentLog.create({
    type,
    createdAt: now(),
    updatedAt: now(),
    ...payload,
  });
}

async function markOrderPaid(order, source, tradeInfo) {
  if (!order) {
    throw new Error("订单不存在");
  }

  const transactionId =
    (tradeInfo && tradeInfo.transaction_id) || order.transactionId || "";
  const paidAt = now();

  if (order.payStatus !== "paid") {
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          payStatus: "paid",
          paymentMode: "wechat_jsapi",
          paidAt,
          updatedAt: paidAt,
          transactionId,
        },
      },
    );

    await createNotification(
      order.publisherOpenId,
      "支付成功",
      "你的订单已支付成功，赏金已进入平台托管。",
      "payment",
      order._id,
    );
  }

  await addPaymentLog("payment_paid", {
    orderId: order._id,
    outTradeNo: order.outTradeNo || "",
    transactionId,
    tradeState: (tradeInfo && tradeInfo.trade_state) || "SUCCESS",
    status: "paid",
    payStatus: "paid",
    responsePayload: tradeInfo || null,
  });

  return {
    orderId: order._id,
    outTradeNo: order.outTradeNo || "",
    totalFee: roundMoney(order.rewardAmount),
    payStatus: "paid",
    refundStatus: order.refundStatus || "",
    source,
    payArgs: null,
  };
}

async function syncRemotePaymentStatusByOrder(order) {
  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.payStatus === "paid") {
    return {
      orderId: order._id,
      payStatus: "paid",
      status: order.status || "pending",
      outTradeNo: order.outTradeNo || "",
      paidAt: order.paidAt || 0,
      refundStatus: order.refundStatus || "",
    };
  }

  if (!order.outTradeNo) {
    return {
      orderId: order._id,
      payStatus: order.payStatus || "unpaid",
      status: order.status || "pending",
      outTradeNo: "",
      paidAt: order.paidAt || 0,
      refundStatus: order.refundStatus || "",
    };
  }

  try {
    const trade = await queryTransactionByOutTradeNo(order.outTradeNo);
    if (trade && trade.trade_state === "SUCCESS") {
      await markOrderPaid(order, "query_reconcile", trade);
      const refreshed = await Order.findById(order._id).lean();
      return {
        orderId: refreshed._id,
        payStatus: refreshed.payStatus || "unpaid",
        status: refreshed.status || "pending",
        outTradeNo: refreshed.outTradeNo || "",
        paidAt: refreshed.paidAt || 0,
        refundStatus: refreshed.refundStatus || "",
      };
    }

    return {
      orderId: order._id,
      payStatus: order.payStatus || "unpaid",
      status: order.status || "pending",
      outTradeNo: order.outTradeNo || "",
      paidAt: order.paidAt || 0,
      tradeState: (trade && trade.trade_state) || "",
      refundStatus: order.refundStatus || "",
    };
  } catch (error) {
    await addPaymentLog("payment_reconcile_fail", {
      orderId: order._id,
      outTradeNo: order.outTradeNo || "",
      status: "failed",
      payStatus: order.payStatus || "unpaid",
      failReason: error.message,
      responsePayload: error.payload || null,
    });

    return {
      orderId: order._id,
      payStatus: order.payStatus || "unpaid",
      status: order.status || "pending",
      outTradeNo: order.outTradeNo || "",
      paidAt: order.paidAt || 0,
      refundStatus: order.refundStatus || "",
    };
  }
}

function isAlreadyPaidError(error) {
  const code = String((error && error.code) || "").toUpperCase();
  const message = String((error && error.message) || "").toUpperCase();

  return (
    code.includes("ORDERPAID") ||
    message.includes("ORDERPAID") ||
    code.includes("ORDER_CLOSED") ||
    message.includes("ORDER_CLOSED") ||
    code.includes("TRADE_STATE_ERROR") ||
    message.includes("TRADE_STATE_ERROR")
  );
}

async function createEscrowPayment(openid, orderId) {
  let order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }
  if (order.publisherOpenId !== openid) {
    throw new Error("只能为自己的订单支付");
  }
  if (order.status !== "pending") {
    throw new Error("当前订单状态不支持继续支付");
  }
  if (["processing", "success"].includes(order.refundStatus || "")) {
    throw new Error("当前订单退款处理中或已退款，无法继续支付");
  }

  if (order.payStatus === "paid") {
    return {
      orderId,
      outTradeNo: order.outTradeNo || "",
      totalFee: roundMoney(order.rewardAmount),
      payStatus: "paid",
      refundStatus: order.refundStatus || "",
      payArgs: null,
    };
  }

  const syncedStatus = await syncRemotePaymentStatusByOrder(order);
  if (syncedStatus.payStatus === "paid") {
    return {
      orderId,
      outTradeNo: syncedStatus.outTradeNo || "",
      totalFee: roundMoney(order.rewardAmount),
      payStatus: "paid",
      refundStatus: syncedStatus.refundStatus || "",
      payArgs: null,
    };
  }

  const orderNo = order.orderNo || createTradeNo("ORD");
  const outTradeNo = order.outTradeNo || createTradeNo("WX");
  if (!order.orderNo || !order.outTradeNo) {
    await Order.updateOne(
      { _id: orderId },
      {
        $set: {
          orderNo,
          outTradeNo,
          updatedAt: now(),
        },
      },
    );
    order = await Order.findById(orderId).lean();
  } else {
    order = Object.assign({}, order, { orderNo, outTradeNo });
  }

  try {
    const total = Math.round(Number(order.rewardAmount || 0) * 100);
    const prepay = await createJsapiPrepay({
      description: `校园代拿订单 ${order.orderNo}`,
      outTradeNo,
      total,
      openid,
    });
    const payArgs = buildMiniProgramPayArgs(prepay.prepay_id);

    await Order.updateOne(
      { _id: orderId },
      {
        $set: {
          prepayId: prepay.prepay_id,
          updatedAt: now(),
        },
      },
    );

    await addPaymentLog("create_escrow_payment", {
      orderId,
      outTradeNo,
      totalFee: total,
      requestPayload: { orderId, openid },
      responsePayload: prepay,
      payArgs,
      status: "created",
      payStatus: order.payStatus || "unpaid",
    });

    return {
      orderId,
      outTradeNo,
      totalFee: roundMoney(order.rewardAmount),
      payStatus: order.payStatus || "unpaid",
      refundStatus: order.refundStatus || "",
      payArgs,
    };
  } catch (error) {
    if (isAlreadyPaidError(error)) {
      const reconciled = await syncRemotePaymentStatusByOrder(order);
      if (reconciled.payStatus === "paid") {
        return {
          orderId,
          outTradeNo: reconciled.outTradeNo || outTradeNo,
          totalFee: roundMoney(order.rewardAmount),
          payStatus: "paid",
          refundStatus: reconciled.refundStatus || "",
          payArgs: null,
        };
      }
    }

    await addPaymentLog("create_escrow_payment_fail", {
      orderId,
      outTradeNo,
      requestPayload: { orderId, openid },
      responsePayload: error.payload || { message: error.message },
      status: "failed",
      payStatus: order.payStatus || "unpaid",
      failReason: error.message,
    });
    await recordAbnormal(openid, "payment_fail", error.message, {
      orderId,
      outTradeNo,
    });

    // 强制打印详细错误，用于调试
    console.error("微信支付创建失败，原始错误:", error.payload);

    throw error;
  }
}

async function getPaymentStatus(openid, orderId) {
  const order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }
  if (order.publisherOpenId !== openid && order.runnerOpenId !== openid) {
    throw new Error("无权查看当前订单支付状态");
  }

  return syncRemotePaymentStatusByOrder(order);
}

async function syncRemoteRefundStatusByOrder(order) {
  if (!order || !order.outRefundNo || !order.refundStatus) {
    return {
      orderId: order ? order._id : "",
      refundStatus: order && order.refundStatus ? order.refundStatus : "",
    };
  }

  if (
    !["processing", "refund_pending", "refund_review"].includes(
      order.refundStatus,
    )
  ) {
    return {
      orderId: order._id,
      refundStatus: order.refundStatus || "",
    };
  }

  try {
    const refund = await queryRefundByOutRefundNo(order.outRefundNo);
    const status = String(refund.status || "").toUpperCase();
    let nextRefundStatus = order.refundStatus;

    if (status === "SUCCESS") {
      nextRefundStatus = "success";
    } else if (["ABNORMAL", "CLOSED"].includes(status)) {
      nextRefundStatus = "failed";
    }

    if (nextRefundStatus !== order.refundStatus) {
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            refundStatus: nextRefundStatus,
            updatedAt: now(),
          },
        },
      );

      await addPaymentLog("refund_status_sync", {
        orderId: order._id,
        outTradeNo: order.outTradeNo || "",
        outRefundNo: order.outRefundNo || "",
        status: nextRefundStatus,
        responsePayload: refund,
      });
    }

    return {
      orderId: order._id,
      refundStatus: nextRefundStatus,
      rawRefundStatus: status,
    };
  } catch (error) {
    await addPaymentLog("refund_status_sync_fail", {
      orderId: order._id,
      outTradeNo: order.outTradeNo || "",
      outRefundNo: order.outRefundNo || "",
      status: "failed",
      failReason: error.message,
      responsePayload: error.payload || null,
    });

    return {
      orderId: order._id,
      refundStatus: order.refundStatus || "",
    };
  }
}

async function applyRefund(order) {
  if (!order) {
    throw new Error("退款目标订单不存在");
  }

  const syncedStatus = await syncRemotePaymentStatusByOrder(order);
  if (syncedStatus.payStatus !== "paid") {
    throw new Error("订单未支付，无法退款");
  }

  const refreshedOrder = await Order.findById(order._id).lean();
  if (!refreshedOrder || refreshedOrder.payStatus !== "paid") {
    throw new Error("订单支付状态异常，无法退款");
  }
  if (!refreshedOrder.outTradeNo) {
    throw new Error("订单缺少商户单号，无法退款");
  }
  if (
    refreshedOrder.refundStatus &&
    ["processing", "success", "refund_review"].includes(
      refreshedOrder.refundStatus,
    )
  ) {
    throw new Error(
      `当前退款状态为 ${refreshedOrder.refundStatus}，请勿重复操作`,
    );
  }

  const outRefundNo = createTradeNo("REF");
  const total = Math.round(Number(refreshedOrder.rewardAmount || 0) * 100);

  try {
    const result = await createRefund({
      outTradeNo: refreshedOrder.outTradeNo,
      outRefundNo,
      reason: "用户取消订单",
      total,
      refund: total,
    });

    await Order.updateOne(
      { _id: refreshedOrder._id },
      {
        $set: {
          refundStatus: "processing",
          outRefundNo,
          refundedAt: now(),
          updatedAt: now(),
        },
      },
    );

    await addPaymentLog("create_refund", {
      orderId: refreshedOrder._id,
      outTradeNo: refreshedOrder.outTradeNo,
      outRefundNo,
      totalFee: total,
      status: "processing",
      responsePayload: result,
    });

    await createNotification(
      refreshedOrder.publisherOpenId,
      "退款处理中",
      "订单已取消，退款正在原路退回，请稍后查看微信支付账单。",
      "refund",
      refreshedOrder._id,
    );

    return result;
  } catch (error) {
    await addPaymentLog("create_refund_fail", {
      orderId: refreshedOrder._id,
      outTradeNo: refreshedOrder.outTradeNo,
      outRefundNo,
      status: "failed",
      failReason: error.message,
      responsePayload: error.payload || null,
    });
    await recordAbnormal(
      refreshedOrder.publisherOpenId,
      "refund_fail",
      error.message,
      {
        orderId: refreshedOrder._id,
        outTradeNo: refreshedOrder.outTradeNo,
        outRefundNo,
      },
    );
    throw error;
  }
}

async function manualReconcileByOrderNo(orderNo) {
  const normalized = String(orderNo || "").trim();
  if (!normalized) {
    throw new Error("请提供订单号");
  }

  const order = await Order.findOne({
    $or: [{ orderNo: normalized }, { outTradeNo: normalized }],
  }).lean();
  if (!order) {
    throw new Error("订单不存在");
  }

  const result = await syncRemotePaymentStatusByOrder(order);
  return Object.assign(
    {
      orderId: order._id,
      orderNo: order.orderNo || "",
      outTradeNo: order.outTradeNo || "",
    },
    result,
  );
}

async function handlePayCallback(headers, rawBody) {
  const signature = headers["wechatpay-signature"];
  const nonce = headers["wechatpay-nonce"];
  const timestamp = headers["wechatpay-timestamp"];

  const valid = verifyCallbackSignature({
    timestamp,
    nonce,
    body: rawBody,
    signature,
  });

  if (!valid) {
    throw new Error("微信支付回调验签失败");
  }

  const callbackBody = JSON.parse(rawBody || "{}");
  const resource = callbackBody.resource;
  if (!resource) {
    throw new Error("微信支付回调缺少 resource");
  }

  const decrypted = decryptCallbackResource(resource);
  const outTradeNo = decrypted.out_trade_no;
  const transactionId = decrypted.transaction_id || "";
  const tradeState = decrypted.trade_state || "";
  const order = await Order.findOne({ outTradeNo }).lean();

  await addPaymentLog("pay_callback", {
    orderId: order ? order._id : "",
    outTradeNo,
    transactionId,
    tradeState,
    status: tradeState === "SUCCESS" ? "callback_success" : "callback_fail",
    notifyRaw: callbackBody,
  });

  if (!order) {
    throw new Error("回调对应订单不存在");
  }

  if (tradeState !== "SUCCESS") {
    return {
      success: true,
      orderId: order._id,
      payStatus: order.payStatus || "unpaid",
      refundStatus: order.refundStatus || "",
    };
  }

  const paidResult = await markOrderPaid(order, "callback", decrypted);
  return Object.assign({}, paidResult, {
    success: true,
    redirectUrl: `${publicBaseUrl}/api/orders/${order._id}/payment-status`,
  });
}

module.exports = {
  createEscrowPayment,
  getPaymentStatus,
  handlePayCallback,
  manualReconcileByOrderNo,
  applyRefund,
  syncRemotePaymentStatusByOrder,
  syncRemoteRefundStatusByOrder,
};

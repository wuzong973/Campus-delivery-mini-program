const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;
const PLATFORM_FEE_RATE = 0.01;
const DEFAULT_NOTIFY_URL =
  "https://wzl136122.cn/pay_notify.php";

function success(data) {
  return {
    success: true,
    data,
  };
}

function fail(message) {
  return {
    success: false,
    message,
  };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatCurrency(value) {
  return `¥${roundMoney(value).toFixed(2)}`;
}

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

function unwrapCallResult(result) {
  if (result && result.result !== undefined) {
    return result.result;
  }

  return result;
}

function createOrderNo(prefix) {
  return `${prefix}${Date.now()}${Math.random().toString().slice(2, 8)}`;
}

async function getCurrentUser(openid) {
  let result = await db
    .collection("users")
    .where({
      openid,
    })
    .limit(1)
    .get();

  if (!result.data.length) {
    result = await db
      .collection("users")
      .where({
        _openid: openid,
      })
      .limit(1)
      .get();
  }

  return result.data[0] || null;
}

async function getOrderById(orderId) {
  const result = await db.collection("orders").doc(orderId).get();
  return result.data;
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

async function recordAbnormal(type, reason, extra) {
  await db.collection("abnormal_logs").add({
    data: {
      type,
      reason,
      extra: extra || {},
      createdAt: Date.now(),
    },
  });
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

async function updatePaymentLogs(orderId, outTradeNo, patch) {
  const result = await db
    .collection("payment_logs")
    .where({
      orderId,
      outTradeNo,
    })
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  return Promise.all(
    result.data.map((item) =>
      db.collection("payment_logs").doc(item._id).update({
        data: Object.assign(
          {
            updatedAt: Date.now(),
          },
          patch || {},
        ),
      }),
    ),
  );
}

async function invokeUnifiedOrder(order, openid) {
  const result = await cloud.callFunction({
    name: "payUnifiedOrder",
    data: {
      orderId: order._id,
      openid,
    },
  });

  const payload = unwrapCallResult(result);

  if (!payload || payload.success === false) {
    throw new Error((payload && payload.message) || "统一下单失败");
  }

  return payload.data !== undefined ? payload.data : payload;
}

async function createEscrowPayment(openid, orderId) {
  ensurePayConfig();

  const order = await getOrderById(orderId);

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.publisherOpenId !== openid) {
    throw new Error("只能为自己的订单付款");
  }

  if (order.status !== "pending") {
    throw new Error("当前订单状态不支持支付");
  }

  if (order.payStatus === "paid") {
    return {
      orderId,
      outTradeNo: order.outTradeNo || "",
      totalFee: roundMoney(order.rewardAmount),
      payStatus: "paid",
      payArgs: null,
    };
  }

  const orderNo = order.orderNo || createOrderNo("ORD");
  const outTradeNo = order.outTradeNo || createOrderNo("WX");

  if (!order.orderNo || !order.outTradeNo) {
    await db.collection("orders").doc(orderId).update({
      data: {
        orderNo,
        outTradeNo,
        updatedAt: Date.now(),
      },
    });
  }

  try {
    const paymentResult = await invokeUnifiedOrder(
      Object.assign({}, order, {
        orderNo,
        outTradeNo,
      }),
      openid,
    );

    await db.collection("orders").doc(orderId).update({
      data: {
        prepayId: paymentResult.prepayId || order.prepayId || "",
        updatedAt: Date.now(),
      },
    });

    await addPaymentLog("create_escrow_payment", {
      orderId,
      outTradeNo,
      totalFee: Math.round(Number(order.rewardAmount || 0) * 100),
      requestPayload: {
        orderId,
        openid,
      },
      responsePayload: paymentResult,
      payStatus: order.payStatus || "unpaid",
      status: "created",
    });

    return {
      orderId,
      outTradeNo,
      totalFee: roundMoney(order.rewardAmount),
      payArgs: paymentResult.payArgs,
    };
  } catch (error) {
    await addPaymentLog("create_escrow_payment_fail", {
      orderId,
      outTradeNo,
      totalFee: Math.round(Number(order.rewardAmount || 0) * 100),
      requestPayload: {
        orderId,
        openid,
      },
      responsePayload: {
        message: error.message,
      },
      payStatus: order.payStatus || "unpaid",
      status: "failed",
      failReason: error.message,
    });

    await recordAbnormal("payment_fail", error.message, {
      orderId,
      outTradeNo,
      openid,
    });
    throw error;
  }
}

async function confirmClientPaid(openid, orderId, outTradeNo) {
  const order = await getOrderById(orderId);

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.publisherOpenId !== openid) {
    throw new Error("仅发布者可确认支付发起状态");
  }

  await addPaymentLog("client_payment_success", {
    orderId,
    outTradeNo: outTradeNo || order.outTradeNo || "",
    payStatus: order.payStatus,
    status: "client_success",
    responsePayload: {
      message: "客户端已完成支付界面返回，等待回调确认",
    },
  });

  return {
    orderId,
    outTradeNo: outTradeNo || order.outTradeNo || "",
    payStatus: order.payStatus || "unpaid",
  };
}

async function getPaymentStatus(openid, orderId) {
  const order = await getOrderById(orderId);

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.publisherOpenId !== openid && order.runnerOpenId !== openid) {
    throw new Error("无权查看当前订单支付状态");
  }

  return {
    orderId,
    payStatus: order.payStatus || "unpaid",
    status: order.status || "pending",
    outTradeNo: order.outTradeNo || "",
    paidAt: order.paidAt || 0,
  };
}

async function getWalletData(openid) {
  const user = await getCurrentUser(openid);

  if (!user) {
    throw new Error("用户不存在，请重新登录");
  }

  const withdrawals = await db
    .collection("withdrawals")
    .where({
      userOpenId: openid,
    })
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const pendingAmount = withdrawals.data
    .filter((item) => item.status === "pending")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    balance: roundMoney(user.walletBalance),
    balanceText: formatCurrency(user.walletBalance),
    totalIncome: roundMoney(user.totalIncome),
    totalIncomeText: formatCurrency(user.totalIncome),
    totalWithdrawn: roundMoney(user.totalWithdrawn),
    totalWithdrawnText: formatCurrency(user.totalWithdrawn),
    pendingWithdrawAmount: roundMoney(pendingAmount),
    pendingWithdrawText: formatCurrency(pendingAmount),
    takeLimitTip: `平台抽成 ${(PLATFORM_FEE_RATE * 100).toFixed(
      0,
    )}% ，跑腿员收益结算到余额后可发起提现。`,
    withdrawals: withdrawals.data.map((withdrawal) => ({
      id: withdrawal._id,
      amount: roundMoney(withdrawal.amount),
      amountText: formatCurrency(withdrawal.amount),
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
      createdAtText: new Date(withdrawal.createdAt).toLocaleString("zh-CN"),
      remark: withdrawal.remark || "",
    })),
  };
}

async function createWithdrawal(openid, amount) {
  const money = roundMoney(amount);

  if (!money || money <= 0) {
    throw new Error("请输入正确的提现金额");
  }

  const user = await getCurrentUser(openid);

  if (!user) {
    throw new Error("用户不存在");
  }

  if (money > roundMoney(user.walletBalance)) {
    throw new Error("可提现余额不足");
  }

  const addResult = await db.collection("withdrawals").add({
    data: {
      userOpenId: openid,
      amount: money,
      status: "pending",
      remark: "待管理员审核后发起提现",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  await db.collection("users").doc(user._id).update({
    data: {
      walletBalance: _.inc(-money),
      updatedAt: Date.now(),
    },
  });

  await createNotification(
    openid,
    "提现申请已提交",
    "提现申请已进入审核队列，请留意后续处理结果。",
    "withdrawal",
    "",
  );

  return {
    withdrawalId: addResult._id,
    amount: money,
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;

  try {
    switch (event.action) {
      case "createEscrowPayment":
        return success(await createEscrowPayment(openid, event.orderId));
      case "confirmClientPaid":
        return success(
          await confirmClientPaid(openid, event.orderId, event.outTradeNo),
        );
      case "getPaymentStatus":
        return success(await getPaymentStatus(openid, event.orderId));
      case "getWalletData":
        return success(await getWalletData(openid));
      case "createWithdrawal":
        return success(await createWithdrawal(openid, event.amount));
      default:
        return fail("不支持的操作类型");
    }
  } catch (error) {
    return fail(error.message || "云函数执行失败");
  }
};

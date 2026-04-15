const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

function unwrapResult(result) {
  const payload = result && result.result !== undefined ? result.result : result;

  if (!payload) {
    return {};
  }

  if (payload.success === false) {
    throw new Error(payload.message || "云端请求失败");
  }

  return payload.data !== undefined ? payload.data : payload;
}

async function invokeFunction(name, data) {
  const result = await cloud.callFunction({
    name,
    data,
  });

  return unwrapResult(result);
}

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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (event.action) {
      case "weappLogin":
        return success(
          await invokeFunction("login", {
            action: "login",
            code: event.code || "",
            userInfo: event.userInfo || null,
            openid,
          }),
        );
      case "getProfile":
        return success(
          await invokeFunction("login", {
            action: "getProfile",
            openid,
          }),
        );
      case "updateProfile":
        return success(
          await invokeFunction("login", {
            action: "updateProfile",
            payload: event.payload || {},
            openid,
          }),
        );
      case "getHomeData":
        return success(
          await invokeFunction("order", {
            action: "getHomeData",
            openid,
          }),
        );
      case "publishOrder":
        return success(
          await invokeFunction("order", {
            action: "publish",
            payload: event.payload || {},
            openid,
          }),
        );
      case "getTaskList":
        return success(
          await invokeFunction("order", {
            action: "getTaskList",
            currentLocation: event.currentLocation || null,
            openid,
          }),
        );
      case "getTaskDetail":
        return success(
          await invokeFunction("order", {
            action: "getTaskDetail",
            orderId: event.orderId,
            openid,
          }),
        );
      case "acceptTask":
        return success(
          await invokeFunction("order", {
            action: "acceptTask",
            orderId: event.orderId,
            currentLocation: event.currentLocation || null,
            openid,
          }),
        );
      case "toggleFavorite":
        return success(
          await invokeFunction("order", {
            action: "toggleFavorite",
            orderId: event.orderId,
            openid,
          }),
        );
      case "uploadDeliveryProof":
        return success(
          await invokeFunction("order", {
            action: "uploadDeliveryProof",
            orderId: event.orderId,
            fileID: event.fileID,
            note: event.note || "",
            openid,
          }),
        );
      case "completeOrder":
        return success(
          await invokeFunction("order", {
            action: "completeOrder",
            orderId: event.orderId,
            openid,
          }),
        );
      case "cancelOrder":
        return success(
          await invokeFunction("order", {
            action: "cancelOrder",
            orderId: event.orderId,
            openid,
          }),
        );
      case "rateRunner":
        return success(
          await invokeFunction("order", {
            action: "rateRunner",
            orderId: event.orderId,
            payload: event.payload || {},
            openid,
          }),
        );
      case "getMineData":
        return success(
          await invokeFunction("order", {
            action: "getMineData",
            openid,
          }),
        );
      case "getOrderList":
        return success(
          await invokeFunction("order", {
            action: "getOrderList",
            status: event.status || "all",
            openid,
          }),
        );
      case "createEscrowPayment":
        return success(
          await invokeFunction("finance", {
            action: "createEscrowPayment",
            orderId: event.orderId,
            openid,
          }),
        );
      case "confirmClientPaid":
        return success(
          await invokeFunction("finance", {
            action: "confirmClientPaid",
            orderId: event.orderId,
            outTradeNo: event.outTradeNo,
            openid,
          }),
        );
      case "getPaymentStatus":
        return success(
          await invokeFunction("finance", {
            action: "getPaymentStatus",
            orderId: event.orderId,
            openid,
          }),
        );
      case "getWalletData":
        return success(
          await invokeFunction("finance", {
            action: "getWalletData",
            openid,
          }),
        );
      case "createWithdrawal":
        return success(
          await invokeFunction("finance", {
            action: "createWithdrawal",
            amount: event.amount,
            openid,
          }),
        );
      case "getDashboard":
        return success(
          await invokeFunction("admin", {
            action: "getDashboard",
            openid,
          }),
        );
      case "auditWithdrawal":
        return success(
          await invokeFunction("admin", {
            action: "auditWithdrawal",
            withdrawalId: event.withdrawalId,
            decision: event.decision,
            openid,
          }),
        );
      default:
        return fail("不支持的云对象动作");
    }
  } catch (error) {
    return fail(error.message || "云对象执行失败");
  }
};

const auth = require("./auth");
const config = require("./config");
const request = require("./request");

const DELIVERY_UPLOAD_TIMEOUT = 30000;
const MAX_ATTACHMENT_COUNT = 3;
const NOTIFICATION_POLL_INTERVAL = 45000;

function sleep(timeout) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

function createError(message, code, extra) {
  const error = new Error(message);
  error.code = code || "API_ERROR";
  if (extra) {
    Object.assign(error, extra);
  }
  return error;
}

function normalizePaymentArgs(paymentResult) {
  const payArgs = paymentResult && paymentResult.payArgs;
  if (!payArgs) {
    throw createError(
      "支付参数缺失，请联系管理员检查微信支付配置。",
      "PAY_CONFIG_MISSING",
    );
  }

  const normalized = {
    timeStamp: String(payArgs.timeStamp || payArgs.timestamp || ""),
    nonceStr: payArgs.nonceStr || "",
    package: payArgs.package || "",
    signType: payArgs.signType || "RSA",
    paySign: payArgs.paySign || "",
  };

  if (
    !normalized.timeStamp ||
    !normalized.nonceStr ||
    !normalized.package ||
    !normalized.paySign
  ) {
    throw createError(
      "支付参数不完整，请联系管理员检查微信支付配置。",
      "PAY_CONFIG_MISSING",
    );
  }

  return normalized;
}

function normalizePaymentError(error) {
  const message = String((error && (error.message || error.errMsg)) || "");

  if (error && error.code === "PAY_CANCEL") {
    return error;
  }

  if (/requestPayment:fail cancel|cancel/i.test(message)) {
    return createError("已取消支付，可在订单页继续支付。", "PAY_CANCEL");
  }

  if (/AUTH_EXPIRED|登录状态已失效/i.test(message)) {
    return createError("登录状态已失效，请稍后重新登录。", "AUTH_EXPIRED");
  }

  if (/配置|mchid|appid|api.?key|private.?key|支付参数/i.test(message)) {
    return createError("支付配置未完成，请联系管理员。", "PAY_CONFIG_MISSING");
  }

  if (/status code 400|下单失败|预支付|微信支付/i.test(message)) {
    return createError("微信支付下单失败，请稍后重试。", "PAY_REQUEST_FAIL");
  }

  if (/PAY_PENDING|确认中|确认支付/i.test(message)) {
    return createError("支付结果确认中，请稍后在订单页查看。", "PAY_PENDING");
  }

  return createError(
    message || "支付请求失败，请稍后重试。",
    "PAY_REQUEST_FAIL",
  );
}

function pollPaymentStatus(orderId) {
  const attempts = Number(config.paymentPollingAttempts || 8);
  const interval = Number(config.paymentPollingInterval || 1500);
  let count = 0;

  function next() {
    count += 1;
    return request
      .request({
        url: `/orders/${orderId}/payment-status`,
        method: "GET",
      })
      .then((result) => {
        if (result && result.payStatus === "paid") {
          return result;
        }

        if (count >= attempts) {
          throw createError(
            "支付结果确认中，请稍后在订单页查看。",
            "PAY_PENDING",
          );
        }

        return sleep(interval).then(next);
      });
  }

  return next();
}

function uploadTaskAttachments(attachments) {
  const files = Array.isArray(attachments)
    ? attachments.filter((item) => item && item.filePath)
    : [];

  if (!files.length) {
    return Promise.resolve([]);
  }

  return auth.ensureLogin().then(() =>
    Promise.all(
      files.slice(0, MAX_ATTACHMENT_COUNT).map((item) =>
        request
          .upload({
            url: "/files/order-attachments",
            filePath: item.filePath,
            name: "file",
          })
          .then((result) => ({
            name: item.name || "",
            type: item.type || "order_attachment",
            filePath: result.url,
            path: result.path,
            filename: result.filename,
            size: result.size,
          })),
      ),
    ),
  );
}

function getHomeData() {
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/home",
      method: "GET",
    }),
  );
}

function getCurrentUserProfile() {
  return auth
    .ensureLogin()
    .then(() =>
      request.request({
        url: "/users/me",
        method: "GET",
      }),
    )
    .then((profile) => {
      auth.updateCachedUser(profile);
      return profile;
    });
}

function updateUserProfile(payload) {
  return auth
    .ensureLogin()
    .then(() =>
      request.request({
        url: "/users/me",
        method: "PATCH",
        data: payload || {},
      }),
    )
    .then((profile) => {
      auth.updateCachedUser(profile);
      return profile;
    });
}

function refreshLogin(userInfo) {
  return auth.login(true, userInfo).then((session) => session.user);
}

function createTask(payload) {
  return uploadTaskAttachments(payload && payload.attachments).then(
    (attachments) =>
      request.request({
        url: "/orders",
        method: "POST",
        data: Object.assign({}, payload, {
          attachments,
        }),
      }),
  );
}

function requestEscrowPayment(orderId) {
  return auth
    .ensureLogin()
    .then(() =>
      request.request({
        url: `/orders/${orderId}/pay`,
        method: "POST",
      }),
    )
    .then((paymentResult) => {
      if (paymentResult && paymentResult.payStatus === "paid") {
        return paymentResult;
      }

      const payArgs = normalizePaymentArgs(paymentResult);
      return new Promise((resolve, reject) => {
        wx.requestPayment({
          ...payArgs,
          success() {
            resolve(paymentResult);
          },
          fail(error) {
            reject(normalizePaymentError(error));
          },
        });
      });
    })
    .then((paymentResult) =>
      paymentResult && paymentResult.payStatus === "paid"
        ? paymentResult
        : pollPaymentStatus(orderId).then((statusResult) =>
            Object.assign({}, paymentResult, {
              payStatus: statusResult.payStatus || "paid",
              refundStatus: statusResult.refundStatus || "",
            }),
          ),
    )
    .catch((error) => {
      throw normalizePaymentError(error);
    });
}

function getTaskList(options) {
  const currentLocation =
    options && options.currentLocation ? options.currentLocation : null;
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/tasks",
      method: "GET",
      data: currentLocation
        ? {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
          }
        : {},
    }),
  );
}

function getTaskDetail(orderId) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/orders/${orderId}`,
      method: "GET",
    }),
  );
}

function acceptTask(orderId, currentLocation) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/orders/${orderId}/accept`,
      method: "POST",
      data: {
        currentLocation: currentLocation || null,
      },
    }),
  );
}

function toggleCollectTask(orderId) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/orders/${orderId}/favorite`,
      method: "POST",
    }),
  );
}

function uploadDeliveryProof(orderId, filePath, note) {
  if (!filePath) {
    return Promise.reject(
      createError("请选择需要上传的送达照片。", "UPLOAD_FILE_MISSING"),
    );
  }

  const uploadPromise = auth.ensureLogin().then(() =>
    request.upload({
      url: "/files/delivery-proof",
      filePath,
      name: "file",
      formData: {
        orderId,
        note: note || "",
      },
    }),
  );

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(createError("上传超时，请检查网络后重试。", "UPLOAD_TIMEOUT"));
    }, DELIVERY_UPLOAD_TIMEOUT);
  });

  return Promise.race([uploadPromise, timeoutPromise]);
}

function completeOrder(orderId) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/orders/${orderId}/complete`,
      method: "POST",
    }),
  );
}

function cancelOrder(orderId) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/orders/${orderId}/cancel`,
      method: "POST",
    }),
  );
}

function rateRunner(orderId, payload) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/orders/${orderId}/rate`,
      method: "POST",
      data: payload || {},
    }),
  );
}

function getMineData() {
  return auth
    .ensureLogin()
    .then(() =>
      request.request({
        url: "/mine",
        method: "GET",
      }),
    )
    .then((data) => {
      if (data.profile) {
        auth.updateCachedUser(data.profile);
      }
      return data;
    });
}

function getOrderList(status) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/orders",
      method: "GET",
      data: {
        status: status || "all",
      },
    }),
  );
}

function getWalletData() {
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/wallet",
      method: "GET",
    }),
  );
}

function createWithdrawal(amount) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/wallet/withdrawals",
      method: "POST",
      data: { amount },
    }),
  );
}

function getAdminDashboard() {
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/admin/dashboard",
      method: "GET",
    }),
  );
}

function auditWithdrawal(withdrawalId, decision) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/admin/withdrawals/${withdrawalId}/audit`,
      method: "POST",
      data: { decision },
    }),
  );
}

function watchMyNotifications(onChange, onError) {
  return auth
    .ensureLogin()
    .then(() => {
      const timer = setInterval(() => {
        if (typeof onChange === "function") {
          onChange();
        }
      }, NOTIFICATION_POLL_INTERVAL);

      return {
        close() {
          clearInterval(timer);
        },
      };
    })
    .catch((error) => {
      if (typeof onError === "function") {
        onError(error);
      }
      throw error;
    });
}

function uploadAvatar(filePath) {
  return auth.ensureLogin().then(() =>
    request.upload({
      url: "/files/avatar",
      filePath,
      name: "file",
    }),
  );
}

function uploadChatImage(filePath) {
  return auth.ensureLogin().then(() =>
    request.upload({
      url: "/files/chat-image",
      filePath,
      name: "file",
    }),
  );
}

function getPlatformFeeHint(reward) {
  const rewardAmount = Number(reward || 0);
  const fee = (rewardAmount * config.platformFeeRate).toFixed(2);
  const runnerIncome = Math.max(rewardAmount - Number(fee), 0).toFixed(2);

  return {
    platformFee: `¥${fee}`,
    runnerIncome: `¥${runnerIncome}`,
  };
}

function openChatSession(payload) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/chat/sessions/open",
      method: "POST",
      data: payload || {},
    }),
  );
}

function getChatSessions() {
  return auth.ensureLogin().then(() =>
    request.request({
      url: "/chat/sessions",
      method: "GET",
    }),
  );
}

function getChatMessages(sessionId) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/chat/sessions/${sessionId}/messages`,
      method: "GET",
    }),
  );
}

function sendChatMessage(sessionId, payload) {
  return auth.ensureLogin().then(() =>
    request.request({
      url: `/chat/sessions/${sessionId}/messages`,
      method: "POST",
      data: payload || {},
    }),
  );
}

module.exports = {
  initDatabase: auth.ensureLogin,
  refreshLogin,
  getHomeData,
  getCurrentUserProfile,
  updateUserProfile,
  createTask,
  requestEscrowPayment,
  getTaskList,
  getTaskDetail,
  acceptTask,
  toggleCollectTask,
  uploadDeliveryProof,
  completeOrder,
  cancelOrder,
  rateRunner,
  getMineData,
  getOrderList,
  getWalletData,
  createWithdrawal,
  getAdminDashboard,
  auditWithdrawal,
  watchMyNotifications,
  getPlatformFeeHint,
  uploadAvatar,
  openChatSession,
  getChatSessions,
  getChatMessages,
  sendChatMessage,
  uploadChatImage,
};

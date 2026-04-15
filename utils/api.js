const auth = require("./auth");
const config = require("./config");
const { getServiceObject } = require("./cloudService");

const DELIVERY_UPLOAD_TIMEOUT = 30000;
const MAX_ATTACHMENT_COUNT = 3;

function uploadTaskAttachments(attachments) {
  const files = Array.isArray(attachments)
    ? attachments.filter((item) => item && item.filePath)
    : [];

  if (!files.length) {
    return Promise.resolve([]);
  }

  return auth.ensureLogin().then(() =>
    Promise.all(
      files.slice(0, MAX_ATTACHMENT_COUNT).map((item) => {
        const ext =
          (item.filePath.split(".").pop() || "jpg").replace(
            /[^a-zA-Z0-9]/g,
            "",
          ) || "jpg";
        const cloudPath = `order-attachments/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${ext}`;

        return wx.cloud
          .uploadFile({
            cloudPath,
            filePath: item.filePath,
          })
          .then((result) =>
            Object.assign({}, item, {
              filePath: result.fileID,
            }),
          );
      }),
    ),
  );
}

function withService(runner) {
  return auth.ensureLogin().then(() => runner(getServiceObject()));
}

function sleep(timeout) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

function createError(message, code, extra) {
  const error = new Error(message);
  if (code) {
    error.code = code;
  }
  if (extra) {
    Object.assign(error, extra);
  }
  return error;
}

function normalizePaymentArgs(paymentResult) {
  const payArgs = paymentResult && paymentResult.payArgs;

  if (!payArgs) {
    throw createError("支付参数缺失，请联系管理员", "PAY_CONFIG_MISSING");
  }

  const normalized = {
    timeStamp: String(payArgs.timeStamp || payArgs.timestamp || ""),
    nonceStr: payArgs.nonceStr || "",
    package: payArgs.package || "",
    signType: payArgs.signType || "MD5",
    paySign: payArgs.paySign || "",
  };

  if (
    !normalized.timeStamp ||
    !normalized.nonceStr ||
    !normalized.package ||
    !normalized.paySign
  ) {
    throw createError("支付参数不完整，请联系管理员", "PAY_CONFIG_MISSING", {
      payArgs,
    });
  }

  return normalized;
}

function normalizePaymentError(error) {
  const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : "";

  if (/requestPayment:fail cancel|cancel/i.test(message)) {
    return createError("已取消支付，可在订单页继续支付", "PAY_CANCEL");
  }

  if (/支付配置|pay config|mchid|appid|api.?key/i.test(message)) {
    return createError("支付配置未完成，请联系管理员", "PAY_CONFIG_MISSING");
  }

  if (/确认中|支付状态确认中/.test(message)) {
    return createError("支付结果确认中，请稍后在订单页查看", "PAY_PENDING");
  }

  if (/unifiedOrder|统一下单|微信支付/.test(message)) {
    return createError("微信支付暂不可用，请稍后重试", "PAY_REQUEST_FAIL");
  }

  return createError(message || "支付请求失败，请稍后重试", "PAY_REQUEST_FAIL");
}

function pollPaymentStatus(orderId) {
  const service = getServiceObject();
  const attempts = Number(config.paymentPollingAttempts || 8);
  const interval = Number(config.paymentPollingInterval || 1500);
  let count = 0;

  function next() {
    count += 1;
    return service.getPaymentStatus({ orderId }).then((result) => {
      if (result && result.payStatus === "paid") {
        return result;
      }

      if (count >= attempts) {
        throw createError("支付结果确认中，请稍后在订单页查看", "PAY_PENDING");
      }

      return sleep(interval).then(next);
    });
  }

  return next();
}

function getHomeData() {
  return withService((service) => service.getHomeData());
}

function getCurrentUserProfile() {
  return withService((service) => service.getProfile()).then((profile) => {
    auth.updateCachedUser(profile);
    return profile;
  });
}

function updateUserProfile(payload) {
  return withService((service) => service.updateProfile(payload)).then(
    (profile) => {
      auth.updateCachedUser(profile);
      return profile;
    },
  );
}

function refreshLogin(userInfo) {
  return auth.login(true, userInfo).then((session) => session.user);
}

function createTask(payload) {
  return uploadTaskAttachments(payload && payload.attachments).then(
    (attachments) => {
      const nextPayload = Object.assign({}, payload, {
        attachments,
      });
      return withService((service) => service.publishOrder(nextPayload));
    },
  );
}

function requestEscrowPayment(orderId) {
  return withService((service) =>
    service.createEscrowPayment({ orderId }),
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
        :
      getServiceObject()
        .confirmClientPaid({
          orderId,
          outTradeNo: paymentResult.outTradeNo,
        })
        .catch(() => null)
        .then(() => pollPaymentStatus(orderId))
        .then((statusResult) =>
          Object.assign({}, paymentResult, {
            payStatus: statusResult.payStatus || "paid",
          }),
        ),
    )
    .catch((error) => {
      throw normalizePaymentError(error);
    });
}

function getTaskList(options) {
  return withService((service) =>
    service.getTaskList({
      currentLocation:
        options && options.currentLocation ? options.currentLocation : null,
    }),
  );
}

function getTaskDetail(orderId) {
  return withService((service) => service.getTaskDetail({ orderId }));
}

function acceptTask(orderId, currentLocation) {
  return withService((service) =>
    service.acceptTask({
      orderId,
      currentLocation: currentLocation || null,
    }),
  );
}

function toggleCollectTask(orderId) {
  return withService((service) => service.toggleFavorite({ orderId }));
}

function uploadDeliveryProof(orderId, filePath, note) {
  if (!filePath) {
    return Promise.reject(
      createError("请选择需要上传的送达照片", "UPLOAD_FILE_MISSING"),
    );
  }

  const uploadPromise = auth.ensureLogin().then(() => {
    const ext =
      (filePath.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "") ||
      "jpg";
    const cloudPath = `delivery-proof/${orderId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    return wx.cloud
      .uploadFile({
        cloudPath,
        filePath,
      })
      .then((uploadResult) => {
        if (!uploadResult || !uploadResult.fileID) {
          throw createError("上传成功但未拿到文件编号，请重试", "UPLOAD_FILE_ID");
        }

        return getServiceObject().uploadDeliveryProof({
          orderId,
          fileID: uploadResult.fileID,
          note: note || "",
        });
      });
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(createError("上传超时，请检查网络后重试", "UPLOAD_TIMEOUT"));
    }, DELIVERY_UPLOAD_TIMEOUT);
  });

  return Promise.race([uploadPromise, timeoutPromise]).catch((error) => {
    const message = error && (error.message || error.errMsg);
    if (/timeout|超时/i.test(message || "")) {
      throw createError("上传超时，请检查网络后重试", "UPLOAD_TIMEOUT");
    }
    if (/fileID/i.test(message || "")) {
      throw createError("图片上传失败，请重新选择照片", "UPLOAD_FILE_ID");
    }
    throw createError(message || "上传失败，请稍后重试", "UPLOAD_FAIL");
  });
}

function completeOrder(orderId) {
  return withService((service) => service.completeOrder({ orderId }));
}

function cancelOrder(orderId) {
  return withService((service) => service.cancelOrder({ orderId }));
}

function rateRunner(orderId, payload) {
  return withService((service) =>
    service.rateRunner({
      orderId,
      ratingPayload: payload,
    }),
  );
}

function getMineData() {
  return withService((service) => service.getMineData()).then((data) => {
    if (data.profile) {
      auth.updateCachedUser(data.profile);
    }
    return data;
  });
}

function getOrderList(status) {
  return withService((service) =>
    service.getOrderList({
      status,
    }),
  );
}

function getWalletData() {
  return withService((service) => service.getWalletData());
}

function createWithdrawal(amount) {
  return withService((service) =>
    service.createWithdrawal({
      amount,
    }),
  );
}

function getAdminDashboard() {
  return withService((service) => service.getDashboard());
}

function auditWithdrawal(withdrawalId, decision) {
  return withService((service) =>
    service.auditWithdrawal({
      withdrawalId,
      decision,
    }),
  );
}

function watchMyNotifications(onChange, onError) {
  return auth.ensureLogin().then((session) => {
    const db = wx.cloud.database();
    return db
      .collection("notifications")
      .where({
        userOpenId: session.openid,
      })
      .watch({
        onChange() {
          if (typeof onChange === "function") {
            onChange();
          }
        },
        onError(error) {
          if (typeof onError === "function") {
            onError(error);
          }
        },
      });
  });
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
};

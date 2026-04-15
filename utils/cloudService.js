let serviceObject = null;

const SERVICE_NAME = "campusService";
const SERVICE_TIMEOUT = 20000;

function unwrapResponse(result) {
  const payload = result && result.result !== undefined ? result.result : result;

  if (!payload) {
    return {};
  }

  if (payload.success === false) {
    throw new Error(payload.message || "云端请求失败");
  }

  return payload.data !== undefined ? payload.data : payload;
}

function normalizeError(error) {
  if (!error) {
    return new Error("云端请求失败");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(error.message || error.errMsg || "云端请求失败");
}

function callService(action, payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error("云端响应超时，请稍后重试"));
    }, SERVICE_TIMEOUT);

    wx.cloud.callFunction({
      name: SERVICE_NAME,
      data: Object.assign({ action }, payload || {}),
      success(result) {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);

        try {
          resolve(unwrapResponse(result));
        } catch (error) {
          reject(normalizeError(error));
        }
      },
      fail(error) {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        reject(normalizeError(error));
      },
    });
  });
}

function createServiceObject() {
  return {
    weappLogin(payload) {
      return callService("weappLogin", {
        code: payload && payload.code ? payload.code : "",
        userInfo: payload && payload.userInfo ? payload.userInfo : null,
      });
    },
    getProfile() {
      return callService("getProfile");
    },
    updateProfile(payload) {
      return callService("updateProfile", {
        payload: payload || {},
      });
    },
    getHomeData() {
      return callService("getHomeData");
    },
    publishOrder(payload) {
      return callService("publishOrder", {
        payload: payload || {},
      });
    },
    getTaskList(payload) {
      return callService("getTaskList", {
        currentLocation:
          payload && payload.currentLocation ? payload.currentLocation : null,
      });
    },
    getTaskDetail(payload) {
      return callService("getTaskDetail", {
        orderId: payload && payload.orderId ? payload.orderId : "",
      });
    },
    acceptTask(payload) {
      return callService("acceptTask", {
        orderId: payload && payload.orderId ? payload.orderId : "",
        currentLocation:
          payload && payload.currentLocation ? payload.currentLocation : null,
      });
    },
    toggleFavorite(payload) {
      return callService("toggleFavorite", {
        orderId: payload && payload.orderId ? payload.orderId : "",
      });
    },
    uploadDeliveryProof(payload) {
      return callService("uploadDeliveryProof", {
        orderId: payload && payload.orderId ? payload.orderId : "",
        fileID: payload && payload.fileID ? payload.fileID : "",
        note: payload && payload.note ? payload.note : "",
      });
    },
    completeOrder(payload) {
      return callService("completeOrder", {
        orderId: payload && payload.orderId ? payload.orderId : "",
      });
    },
    cancelOrder(payload) {
      return callService("cancelOrder", {
        orderId: payload && payload.orderId ? payload.orderId : "",
      });
    },
    rateRunner(payload) {
      return callService("rateRunner", {
        orderId: payload && payload.orderId ? payload.orderId : "",
        payload: payload && payload.ratingPayload ? payload.ratingPayload : {},
      });
    },
    getMineData() {
      return callService("getMineData");
    },
    getOrderList(payload) {
      return callService("getOrderList", {
        status: payload && payload.status ? payload.status : "all",
      });
    },
    createEscrowPayment(payload) {
      return callService("createEscrowPayment", {
        orderId: payload && payload.orderId ? payload.orderId : "",
      });
    },
    confirmClientPaid(payload) {
      return callService("confirmClientPaid", {
        orderId: payload && payload.orderId ? payload.orderId : "",
        outTradeNo: payload && payload.outTradeNo ? payload.outTradeNo : "",
      });
    },
    getPaymentStatus(payload) {
      return callService("getPaymentStatus", {
        orderId: payload && payload.orderId ? payload.orderId : "",
      });
    },
    getWalletData() {
      return callService("getWalletData");
    },
    createWithdrawal(payload) {
      return callService("createWithdrawal", {
        amount: payload && payload.amount ? payload.amount : 0,
      });
    },
    getDashboard() {
      return callService("getDashboard");
    },
    auditWithdrawal(payload) {
      return callService("auditWithdrawal", {
        withdrawalId:
          payload && payload.withdrawalId ? payload.withdrawalId : "",
        decision: payload && payload.decision ? payload.decision : "",
      });
    },
  };
}

function getServiceObject() {
  if (!serviceObject) {
    serviceObject = createServiceObject();
  }

  return serviceObject;
}

module.exports = {
  getServiceObject,
};

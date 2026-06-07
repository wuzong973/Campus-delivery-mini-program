const request = require("./request");

function getServiceObject() {
  return {
    weappLogin(payload) {
      return request.request({
        url: "/auth/login",
        method: "POST",
        data: payload || {},
      });
    },
    getProfile() {
      return request.request({
        url: "/users/me",
        method: "GET",
      });
    },
    updateProfile(payload) {
      return request.request({
        url: "/users/me",
        method: "PATCH",
        data: payload || {},
      });
    },
    getHomeData() {
      return request.request({
        url: "/home",
        method: "GET",
      });
    },
    publishOrder(payload) {
      return request.request({
        url: "/orders",
        method: "POST",
        data: payload || {},
      });
    },
    getTaskList(payload) {
      return request.request({
        url: "/tasks",
        method: "GET",
        data: payload && payload.currentLocation ? payload.currentLocation : {},
      });
    },
    getTaskDetail(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}`,
        method: "GET",
      });
    },
    acceptTask(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}/accept`,
        method: "POST",
        data: {
          currentLocation:
            payload && payload.currentLocation ? payload.currentLocation : null,
        },
      });
    },
    toggleFavorite(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}/favorite`,
        method: "POST",
      });
    },
    completeOrder(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}/complete`,
        method: "POST",
      });
    },
    cancelOrder(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}/cancel`,
        method: "POST",
      });
    },
    rateRunner(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}/rate`,
        method: "POST",
        data: payload && payload.ratingPayload ? payload.ratingPayload : {},
      });
    },
    getMineData() {
      return request.request({
        url: "/mine",
        method: "GET",
      });
    },
    getOrderList(payload) {
      return request.request({
        url: "/orders",
        method: "GET",
        data: {
          status: payload && payload.status ? payload.status : "all",
        },
      });
    },
    createEscrowPayment(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}/pay`,
        method: "POST",
      });
    },
    getPaymentStatus(payload) {
      return request.request({
        url: `/orders/${payload && payload.orderId ? payload.orderId : ""}/payment-status`,
        method: "GET",
      });
    },
    getWalletData() {
      return request.request({
        url: "/wallet",
        method: "GET",
      });
    },
    createWithdrawal(payload) {
      return request.request({
        url: "/wallet/withdrawals",
        method: "POST",
        data: {
          amount: payload && payload.amount ? payload.amount : 0,
        },
      });
    },
    getDashboard() {
      return request.request({
        url: "/admin/dashboard",
        method: "GET",
      });
    },
    auditWithdrawal(payload) {
      return request.request({
        url: `/admin/withdrawals/${payload && payload.withdrawalId ? payload.withdrawalId : ""}/audit`,
        method: "POST",
        data: {
          decision: payload && payload.decision ? payload.decision : "",
        },
      });
    },
  };
}

module.exports = {
  getServiceObject,
};

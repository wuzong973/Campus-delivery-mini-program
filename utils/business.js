const TYPE_TEXT = {
  takeout: "外卖",
  parcel: "快递",
  helpBuy: "帮买物品",
  document: "文件资料",
  other: "其他",
};

const TYPE_OPTIONS = Object.keys(TYPE_TEXT).map((value) => ({
  value,
  label: TYPE_TEXT[value],
}));

const STATUS_MAP = {
  pending: "待接单",
  accepted: "待送达",
  delivered: "待完成",
  completed: "已完成",
  cancelled: "已取消",
};

const PAY_STATUS_MAP = {
  unpaid: "待支付",
  paid: "已支付",
  refund_pending: "待退款",
  refund_review: "退款审核中",
};

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatCurrency(value) {
  return `¥${roundMoney(value).toFixed(2)}`;
}

function padNumber(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  const diff = Date.now() - new Date(timestamp).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return `${Math.floor(diff / day)} 天前`;
}

function getAvatarText(name) {
  return name ? String(name).trim().slice(0, 1) : "我";
}

function isPhone(value) {
  return /^1\d{10}$/.test(String(value || "").trim());
}

function getProfileCompletion(profile) {
  const missingFields = [];

  if (!String((profile && profile.nickname) || "").trim()) {
    missingFields.push("昵称");
  }

  if (!isPhone(profile && profile.phone)) {
    missingFields.push("手机号");
  }

  if (!String((profile && profile.commonAddress) || "").trim()) {
    missingFields.push("常用地址");
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    missingText: missingFields.join("、"),
  };
}

function normalizeUser(user) {
  const profileState = getProfileCompletion(user || {});
  const nickname = user.nickname || "校园同学";

  return {
    id: user._id || user.id || "",
    openid: user.openid || user._openid || "",
    nickname,
    phone: user.phone || "",
    commonAddress: user.commonAddress || "",
    avatarTheme: user.avatarTheme || "ocean",
    avatarText: getAvatarText(nickname),
    slogan: user.slogan || "",
    role: user.role || "user",
    completedJobs: Number(user.completedJobs || 0),
    averageScore: Number(user.averageScore || 0),
    ratingText: Number(user.averageScore || 0).toFixed(1),
    profileComplete: profileState.isComplete,
    missingProfileFields: profileState.missingFields,
    missingProfileText: profileState.missingText,
  };
}

function getSettlement(rewardAmount, platformFeeRate = 0.01) {
  const reward = roundMoney(rewardAmount);
  const platformFee = roundMoney(reward * platformFeeRate);
  const runnerIncome = roundMoney(reward - platformFee);

  return {
    rewardAmount: reward,
    platformFee,
    runnerIncome,
  };
}

function getPickupTimeText(order) {
  if (!order.pickupTimeType || order.pickupTimeType === "asap") {
    return "尽快取件";
  }

  return order.pickupTimeValue || "预约取件";
}

function buildTimeline(order) {
  return [
    {
      key: "created",
      title: "已创建",
      timeText: formatTime(order.createdAt),
      done: true,
    },
    {
      key: "accepted",
      title: "已接单",
      timeText: order.acceptedAt ? formatTime(order.acceptedAt) : "等待接单",
      done: !!order.acceptedAt,
    },
    {
      key: "delivered",
      title: "已送达",
      timeText: order.deliveredAt ? formatTime(order.deliveredAt) : "待上传送达凭证",
      done: !!order.deliveredAt,
    },
    {
      key: "completed",
      title: "已完成",
      timeText: order.completedAt ? formatTime(order.completedAt) : "待完成",
      done: !!order.completedAt,
    },
  ];
}

function enrichOrder(order, currentOpenid, userMap = {}, favoriteSet = new Set()) {
  const publisher = normalizeUser(userMap[order.publisherOpenId] || {});
  const runner = order.runnerOpenId
    ? normalizeUser(userMap[order.runnerOpenId] || {})
    : null;
  const isMine = order.publisherOpenId === currentOpenid;
  const isRunner = order.runnerOpenId === currentOpenid;
  const canViewContact = isMine || isRunner;
  const canAccept = order.status === "pending" && order.payStatus === "paid" && !isMine;
  const canCancel = isMine && order.status === "pending";
  const canComplete = isRunner && order.status === "delivered";
  const canUploadProof = isRunner && order.status === "accepted";
  const canPay = isMine && order.status === "pending" && order.payStatus === "unpaid";
  const canRate =
    isMine && order.status === "completed" && order.runnerOpenId && !order.rating;

  return Object.assign({}, order, {
    id: order._id || order.id,
    _id: order._id || order.id,
    contactPhoneText: canViewContact ? order.contactPhone : "接单后可见",
    typeText: TYPE_TEXT[order.type] || "其他",
    pickupTimeText: getPickupTimeText(order),
    rewardText: formatCurrency(order.rewardAmount),
    platformFeeText: formatCurrency(order.platformFee),
    runnerIncomeText: formatCurrency(order.runnerIncome),
    statusText: STATUS_MAP[order.status] || "未知状态",
    payStatusText: PAY_STATUS_MAP[order.payStatus] || "未知",
    createdAtText: formatRelativeTime(order.createdAt),
    createdAtFullText: formatTime(order.createdAt),
    isMine,
    isRunner,
    canViewContact,
    canAccept,
    canCancel,
    canComplete,
    canUploadProof,
    canPay,
    canRate,
    isCollected: favoriteSet.has(order._id || order.id),
    publisher,
    runner,
    timeline: buildTimeline(order),
  });
}

module.exports = {
  TYPE_TEXT,
  TYPE_OPTIONS,
  STATUS_MAP,
  PAY_STATUS_MAP,
  roundMoney,
  formatCurrency,
  padNumber,
  formatTime,
  formatRelativeTime,
  getAvatarText,
  isPhone,
  getProfileCompletion,
  normalizeUser,
  getSettlement,
  getPickupTimeText,
  buildTimeline,
  enrichOrder,
};

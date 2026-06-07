const { v4: uuidv4 } = require("uuid");

const {
  User,
  Order,
  Notification,
  Favorite,
  PaymentLog,
  AbnormalLog,
  SettlementLog,
  SystemStat,
  Chat,
  ChatSession,
} = require("../models");

const PLATFORM_FEE_RATE = 0.01;
const TAKE_LIMIT = 10;

const STATUS_MAP = {
  pending: "待接单",
  accepted: "待取送",
  delivered: "已送达待完成",
  completed: "已完成",
  cancelled: "已取消",
};

const PAY_STATUS_MAP = {
  unpaid: "待支付",
  paid: "已托管",
  refund_pending: "待退款",
  refund_review: "退款审核中",
};

const TYPE_MAP = {
  takeout: "外卖",
  parcel: "快递",
  helpBuy: "帮买",
  document: "文件",
  other: "其他",
};

const PRICING_RULES = {
  baseReward: 2,
  largeItemFee: 1,
  helpBuyExtraFee: 0.5,
  urgentFee: 1,
};

function now() {
  return Date.now();
}

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
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(
    date.getDate(),
  )} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  const diff = now() - timestamp;
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

function getProfileState(user) {
  const missingFields = [];
  if (!String((user && user.nickname) || "").trim()) missingFields.push("昵称");
  if (!isPhone(user && user.phone)) missingFields.push("手机号");
  if (!String((user && user.commonAddress) || "").trim()) {
    missingFields.push("常用地址");
  }
  return {
    isComplete: missingFields.length === 0,
    missingFields,
    missingText: missingFields.join("、"),
  };
}

function normalizeUser(user) {
  const profileState = getProfileState(user || {});
  return {
    id: user ? user._id : "",
    openid: (user && user.openid) || "",
    nickname: (user && user.nickname) || "校园同学",
    phone: (user && user.phone) || "",
    commonAddress: (user && user.commonAddress) || "",
    avatarTheme: (user && user.avatarTheme) || "ocean",
    avatarText: getAvatarText((user && user.nickname) || "我"),
    slogan: (user && user.slogan) || "",
    role: (user && user.role) || "user",
    completedJobs: Number((user && user.completedJobs) || 0),
    averageScore: Number((user && user.averageScore) || 0),
    ratingText: Number((user && user.averageScore) || 0).toFixed(1),
    walletBalance: roundMoney(user && user.walletBalance),
    totalIncome: roundMoney(user && user.totalIncome),
    totalWithdrawn: roundMoney(user && user.totalWithdrawn),
    totalSpending: roundMoney(user && user.totalSpending),
    avatarUrl: (user && user.avatarUrl) || "",
    profileComplete: profileState.isComplete,
    missingProfileFields: profileState.missingFields,
    missingProfileText: profileState.missingText,
  };
}

function extractCampusArea(text) {
  const content = String(text || "");
  const rules = [
    { match: /东区|东苑|东门|东食堂|东驿站/, value: "东区" },
    { match: /西区|西苑|西门|西食堂|西驿站/, value: "西区" },
    { match: /南区|南苑|南门/, value: "南区" },
    { match: /北区|北苑|北门/, value: "北区" },
    { match: /食堂/, value: "食堂区" },
    { match: /驿站|快递|菜鸟|顺丰|京东/, value: "驿站区" },
    { match: /宿舍|公寓|楼栋|号楼/, value: "宿舍区" },
    { match: /教学楼|图书馆|实验楼|学院/, value: "教学区" },
  ];
  const matched = rules.find((item) => item.match.test(content));
  return matched ? matched.value : "综合区";
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(from, to) {
  if (!from || !to) return -1;
  const lat1 = Number(from.latitude);
  const lon1 = Number(from.longitude);
  const lat2 = Number(to.latitude);
  const lon2 = Number(to.longitude);
  if ([lat1, lon1, lat2, lon2].some((item) => Number.isNaN(item))) return -1;
  const earthRadius = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c * 100) / 100;
}

function formatDistance(distanceKm) {
  const distance = Number(distanceKm);
  if (!distance || distance < 0) return "待定位";
  if (distance < 1) return `${Math.round(distance * 1000)}m`;
  return `${distance.toFixed(distance >= 10 ? 0 : 1)}km`;
}

function getEtaText(distanceKm) {
  const distance = Number(distanceKm);
  if (!distance || distance < 0) return "待估算";
  return `约 ${Math.max(6, Math.round(distance * 6))} 分钟`;
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
      title: "已提交",
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
      timeText: order.deliveredAt
        ? formatTime(order.deliveredAt)
        : "待拍照送达",
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

function getSettlement(rewardAmount) {
  const reward = roundMoney(rewardAmount);
  const platformFee = roundMoney(reward * PLATFORM_FEE_RATE);
  const runnerIncome = roundMoney(reward - platformFee);
  return {
    rewardAmount: reward,
    platformFee,
    runnerIncome,
  };
}

function getPricingDetails(payload) {
  const type = String(payload.type || "takeout");
  const isLargeItem = !!payload.isLargeItem;
  const itemCount = Math.max(1, parseInt(payload.itemCount || 1, 10) || 1);
  const isUrgent = !!payload.isUrgent;
  const baseReward = Math.max(
    PRICING_RULES.baseReward,
    Number(payload.basePrice || 0),
  );
  const largeItemFee =
    type === "parcel" && isLargeItem ? PRICING_RULES.largeItemFee : 0;
  const itemCountFee =
    type === "helpBuy" && itemCount > 5 ? PRICING_RULES.helpBuyExtraFee : 0;
  const urgentFee = isUrgent ? PRICING_RULES.urgentFee : 0;
  const rewardAmount = roundMoney(
    baseReward + largeItemFee + itemCountFee + urgentFee,
  );
  const settlement = getSettlement(rewardAmount);

  return {
    type,
    isLargeItem,
    itemCount,
    isUrgent,
    baseReward,
    largeItemFee,
    itemCountFee,
    urgentFee,
    rewardAmount,
    platformFee: settlement.platformFee,
    runnerIncome: settlement.runnerIncome,
    pricingSnapshot: {
      baseReward,
      largeItemFee,
      itemCountFee,
      urgentFee,
      totalReward: rewardAmount,
    },
  };
}

function createTradeNo(prefix) {
  return `${prefix}${Date.now()}${Math.random().toString().slice(2, 8)}`;
}

async function getCurrentUser(openid) {
  if (!openid) return null;
  return User.findOne({ openid }).lean();
}

async function getUsersMap(openids) {
  const validOpenids = Array.from(new Set((openids || []).filter(Boolean)));
  if (!validOpenids.length) return {};
  const users = await User.find({ openid: { $in: validOpenids } }).lean();
  return users.reduce((result, item) => {
    result[item.openid] = item;
    return result;
  }, {});
}

async function getFavoriteSet(openid, orderIds) {
  const validIds = Array.from(new Set((orderIds || []).filter(Boolean)));
  if (!openid || !validIds.length) return new Set();
  const favorites = await Favorite.find({
    userOpenId: openid,
    orderId: { $in: validIds },
  }).lean();
  return new Set(favorites.map((item) => item.orderId));
}

async function createNotification(userOpenId, title, content, type, orderId) {
  if (!userOpenId) return null;
  return Notification.create({
    userOpenId,
    title,
    content,
    type: type || "system",
    orderId: orderId || "",
    read: false,
    createdAt: now(),
  });
}

async function recordAbnormal(userOpenId, type, reason, extra) {
  return AbnormalLog.create({
    userOpenId: userOpenId || "",
    type,
    reason,
    extra: extra || {},
    createdAt: now(),
  });
}

async function detectPublishFrequency(userOpenId) {
  if (!userOpenId) return;
  const recentCount = await Order.countDocuments({
    publisherOpenId: userOpenId,
    createdAt: { $gte: now() - 10 * 60 * 1000 },
  });
  if (recentCount >= 5) {
    await recordAbnormal(
      userOpenId,
      "publish_frequency",
      "10 分钟内发布订单过多",
      {
        count: recentCount,
      },
    );
  }
}

async function detectCancelFrequency(userOpenId) {
  if (!userOpenId) return;
  const cancelCount = await Order.countDocuments({
    publisherOpenId: userOpenId,
    status: "cancelled",
    cancelledAt: { $gte: now() - 24 * 60 * 60 * 1000 },
  });
  if (cancelCount >= 3) {
    await recordAbnormal(
      userOpenId,
      "cancel_frequency",
      "24 小时内取消订单过多",
      {
        count: cancelCount,
      },
    );
  }
}

async function ensureTakeCount(openid) {
  const count = await Order.countDocuments({
    runnerOpenId: openid,
    status: { $in: ["accepted", "delivered"] },
  });
  if (count >= TAKE_LIMIT) {
    throw new Error(`当前最多只能同时承接 ${TAKE_LIMIT} 单任务`);
  }
}

function appendDistanceInfo(orders, currentLocation) {
  return (orders || []).map((item) => ({
    ...item,
    distanceKm: calculateDistanceKm(
      currentLocation,
      item.pickupLocation || item.deliveryLocation,
    ),
  }));
}

function resolveMediaUrl(pathOrUrl, publicBaseUrl) {
  if (!pathOrUrl) return "";
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  if (String(pathOrUrl).startsWith("cloud://")) return pathOrUrl;
  return `${publicBaseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function enrichOrder(
  order,
  currentOpenid,
  userMap,
  favoriteSet,
  publicBaseUrl,
) {
  const publisher = normalizeUser(
    (userMap && userMap[order.publisherOpenId]) || {},
  );
  const runner = order.runnerOpenId
    ? normalizeUser((userMap && userMap[order.runnerOpenId]) || {})
    : null;
  const isMine = order.publisherOpenId === currentOpenid;
  const isRunner = order.runnerOpenId === currentOpenid;
  const canViewContact = isMine || isRunner;
  const canAccept =
    order.status === "pending" && order.payStatus === "paid" && !isMine;
  const canCancel = isMine && order.status === "pending";
  const canComplete = isRunner && order.status === "delivered";
  const canUploadProof = isRunner && order.status === "accepted";
  const canPay =
    isMine && order.status === "pending" && order.payStatus === "unpaid";
  const canRate =
    isMine &&
    order.status === "completed" &&
    order.runnerOpenId &&
    !order.rating;
  const distanceKm = Number(order.distanceKm);
  const favoriteIds = favoriteSet || new Set();

  const attachments = Array.isArray(order.attachments)
    ? order.attachments.map((item) => ({
        ...item,
        displayUrl: resolveMediaUrl(
          item.displayUrl || item.filePath,
          publicBaseUrl,
        ),
        filePath: resolveMediaUrl(item.filePath, publicBaseUrl),
      }))
    : [];

  const deliveryProof =
    order.deliveryProof && order.deliveryProof.fileID
      ? {
          ...order.deliveryProof,
          displayUrl: resolveMediaUrl(
            order.deliveryProof.displayUrl || order.deliveryProof.fileID,
            publicBaseUrl,
          ),
        }
      : order.deliveryProof || null;

  return {
    id: order._id,
    _id: order._id,
    receiverName: order.receiverName,
    contactPhone: canViewContact ? order.contactPhone : "",
    contactPhoneText: canViewContact ? order.contactPhone : "接单后可见",
    type: order.type,
    typeText: TYPE_MAP[order.type] || TYPE_MAP.other,
    pickupAddress: order.pickupAddress,
    deliveryAddress: order.deliveryAddress,
    pickupLocation: order.pickupLocation || null,
    deliveryLocation: order.deliveryLocation || null,
    campusAreaText:
      order.campusAreaText ||
      extractCampusArea(order.pickupAddress || order.deliveryAddress),
    pickupTimeType: order.pickupTimeType || "asap",
    pickupTimeValue: order.pickupTimeValue || "",
    pickupTimeText: getPickupTimeText(order),
    deliveryBuilding: order.deliveryBuilding || "",
    deliveryRoom: order.deliveryRoom || "",
    deliveryBuildingText: order.deliveryBuilding || "未填",
    deliveryRoomText: order.deliveryRoom || "未填",
    hasDeliveryDormInfo: !!(order.deliveryBuilding || order.deliveryRoom),
    attachments,
    remark: order.remark || "",
    rewardAmount: roundMoney(order.rewardAmount),
    rewardText: formatCurrency(order.rewardAmount),
    platformFee: roundMoney(order.platformFee),
    platformFeeText: formatCurrency(order.platformFee),
    runnerIncome: roundMoney(order.runnerIncome),
    runnerIncomeText: formatCurrency(order.runnerIncome),
    status: order.status,
    statusText: STATUS_MAP[order.status] || "未知状态",
    payStatus: order.payStatus,
    payStatusText: PAY_STATUS_MAP[order.payStatus] || "未知支付状态",
    paymentMode: order.paymentMode || "",
    outTradeNo: order.outTradeNo || "",
    refundStatus: order.refundStatus || "",
    createdAt: order.createdAt,
    createdAtText: formatRelativeTime(order.createdAt),
    createdAtFullText: formatTime(order.createdAt),
    acceptedAtText: order.acceptedAt ? formatTime(order.acceptedAt) : "",
    acceptedAtDisplay: order.acceptedAt ? formatTime(order.acceptedAt) : "暂无",
    deliveredAtText: order.deliveredAt ? formatTime(order.deliveredAt) : "",
    deliveredAtDisplay: order.deliveredAt
      ? formatTime(order.deliveredAt)
      : "暂无",
    completedAtText: order.completedAt ? formatTime(order.completedAt) : "",
    completedAtDisplay: order.completedAt
      ? formatTime(order.completedAt)
      : "暂无",
    distanceKm: distanceKm > 0 ? distanceKm : -1,
    distanceText: formatDistance(distanceKm),
    etaText: getEtaText(distanceKm),
    overDistanceLimit: distanceKm > 5,
    isMine,
    isRunner,
    canViewContact,
    roleText: isMine ? "我发布的" : "我接的单",
    canAccept,
    canCancel,
    canComplete,
    canUploadProof,
    canPay,
    canRate,
    hasAction: canCancel || canComplete || canUploadProof || canPay,
    showOrderEntry:
      !canAccept && !canCancel && !canComplete && !canUploadProof && !canPay,
    isCollected: favoriteIds.has(order._id),
    publisher,
    publisherSloganText: publisher.slogan || "微信登录用户",
    runner,
    runnerPhoneText:
      runner && canViewContact && runner.phone
        ? runner.phone
        : runner
          ? "接单后可见"
          : "未完成",
    runnerScoreText: runner ? runner.averageScore || 0 : 0,
    runnerCompletedJobsText: runner ? runner.completedJobs || 0 : 0,
    deliveryProof,
    proofNoteText:
      deliveryProof && deliveryProof.note
        ? deliveryProof.note
        : "已上传送达照片",
    rating: order.rating || null,
    timeline: buildTimeline(order),
  };
}

async function buildEnrichedOrders(orders, currentOpenid, publicBaseUrl) {
  const openids = [];
  const ids = [];
  (orders || []).forEach((item) => {
    openids.push(item.publisherOpenId);
    openids.push(item.runnerOpenId);
    ids.push(item._id);
  });
  const userMap = await getUsersMap(openids);
  const favoriteSet = await getFavoriteSet(currentOpenid, ids);
  return (orders || []).map((item) =>
    enrichOrder(item, currentOpenid, userMap, favoriteSet, publicBaseUrl),
  );
}

async function upsertFinanceStats(totalFee, platformFee, runnerIncome) {
  const existing = await SystemStat.findById("finance").lean();
  if (!existing) {
    await SystemStat.create({
      _id: "finance",
      totalVolume: roundMoney(totalFee),
      platformIncome: roundMoney(platformFee),
      totalRunnerIncome: roundMoney(runnerIncome),
      updatedAt: now(),
    });
    return;
  }

  await SystemStat.updateOne(
    { _id: "finance" },
    {
      $set: {
        updatedAt: now(),
      },
      $inc: {
        totalVolume: roundMoney(totalFee),
        platformIncome: roundMoney(platformFee),
        totalRunnerIncome: roundMoney(runnerIncome),
      },
    },
  );
}

async function settleOrderIfNeeded(order, runnerUser, publisherUser) {
  const existing = await SettlementLog.findById(order._id).lean();
  if (existing && existing.status === "settled") {
    return existing;
  }

  await User.updateOne(
    { _id: runnerUser._id },
    {
      $inc: {
        walletBalance: roundMoney(order.runnerIncome),
        totalIncome: roundMoney(order.runnerIncome),
        completedJobs: 1,
      },
      $set: {
        updatedAt: now(),
      },
    },
  );

  if (publisherUser) {
    await User.updateOne(
      { _id: publisherUser._id },
      {
        $inc: {
          totalSpending: roundMoney(order.rewardAmount),
        },
        $set: {
          updatedAt: now(),
        },
      },
    );
  }

  await upsertFinanceStats(
    order.rewardAmount,
    order.platformFee,
    order.runnerIncome,
  );

  const settlementDoc = {
    _id: order._id,
    orderId: order._id,
    runnerOpenId: order.runnerOpenId,
    publisherOpenId: order.publisherOpenId,
    rewardAmount: roundMoney(order.rewardAmount),
    platformFee: roundMoney(order.platformFee),
    runnerIncome: roundMoney(order.runnerIncome),
    status: "settled",
    createdAt: now(),
    updatedAt: now(),
  };
  await SettlementLog.findOneAndUpdate(
    { _id: order._id },
    { $set: settlementDoc },
    { upsert: true, new: true },
  );
  return settlementDoc;
}

function buildChatPreview(type, content) {
  if (type === "image") {
    return "[图片]";
  }
  if (type === "emoji") {
    return String(content || "[表情]").trim();
  }
  return String(content || "")
    .trim()
    .slice(0, 80);
}

function normalizeChatType(type) {
  return ["text", "image", "emoji"].includes(type) ? type : "text";
}

function inferLegacyChatType(message) {
  const content = String((message && message.content) || "").trim();
  if (
    /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(content) ||
    /\/uploads\/chat-images\//i.test(content)
  ) {
    return "image";
  }
  return normalizeChatType(message && message.type);
}

function formatChatMessage(message, currentOpenid) {
  const type = inferLegacyChatType(message);
  const content = String(message.content || "").trim();
  const imageUrl =
    type === "image"
      ? resolveMediaUrl(message.imageUrl || message.content, "")
      : "";

  return {
    id: message._id,
    sessionId: message.sessionId || "",
    orderId: message.orderId || "",
    type,
    content: type === "image" ? "" : content,
    imageUrl,
    previewText: buildChatPreview(type, content || imageUrl),
    isMe: message.fromUserOpenId === currentOpenid,
    createdAt: Number(message.createdAt || 0),
    timeText: formatTime(message.createdAt),
  };
}

async function bindLegacyMessagesToSession(
  session,
  currentUser,
  counterpartUser,
) {
  if (!session || !currentUser || !counterpartUser) {
    return;
  }

  const legacyMessages = await Chat.find({
    $and: [
      {
        $or: [
          { sessionId: { $exists: false } },
          { sessionId: "" },
          { sessionId: null },
        ],
      },
      {
        $or: [
          { fromUserId: currentUser._id, toUserId: counterpartUser._id },
          { fromUserId: counterpartUser._id, toUserId: currentUser._id },
        ],
      },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!legacyMessages.length) {
    return;
  }

  await Promise.all(
    legacyMessages.map((item) =>
      Chat.updateOne(
        { _id: item._id },
        {
          $set: {
            sessionId: session._id,
            orderId: session.orderId || "",
            fromUserOpenId:
              item.fromUserId === currentUser._id
                ? currentUser.openid
                : counterpartUser.openid,
            toUserOpenId:
              item.toUserId === currentUser._id
                ? currentUser.openid
                : counterpartUser.openid,
            type: inferLegacyChatType(item),
            imageUrl:
              inferLegacyChatType(item) === "image"
                ? String(item.imageUrl || item.content || "").trim()
                : "",
            readByOpenIds: Array.isArray(item.readByOpenIds)
              ? item.readByOpenIds
              : [],
          },
        },
      ),
    ),
  );

  const lastLegacyMessage = legacyMessages[legacyMessages.length - 1];
  if (
    lastLegacyMessage &&
    (!session.lastMessageAt ||
      Number(lastLegacyMessage.createdAt || 0) >
        Number(session.lastMessageAt || 0))
  ) {
    await ChatSession.updateOne(
      { _id: session._id },
      {
        $set: {
          lastMessageText: buildChatPreview(
            inferLegacyChatType(lastLegacyMessage),
            String(lastLegacyMessage.content || "").trim(),
          ),
          lastMessageType: inferLegacyChatType(lastLegacyMessage),
          lastMessageAt: Number(lastLegacyMessage.createdAt || now()),
          updatedAt: now(),
        },
      },
    );
  }
}

async function requireChatContext(currentOpenid, orderId, targetUserId) {
  const currentUser = await getCurrentUser(currentOpenid);
  const order = await Order.findById(orderId).lean();

  if (!currentUser) {
    throw new Error("用户不存在，请重新登录");
  }

  if (!order) {
    throw new Error("订单不存在");
  }

  const isPublisher = order.publisherOpenId === currentOpenid;
  const isRunner = order.runnerOpenId === currentOpenid;

  if (!isPublisher && !isRunner) {
    throw new Error("只有订单双方可以进入聊天");
  }

  const counterpartOpenid = isPublisher
    ? order.runnerOpenId
    : order.publisherOpenId;

  if (!counterpartOpenid) {
    throw new Error("订单暂未匹配聊天对象");
  }

  let targetUser = null;
  if (targetUserId) {
    targetUser = await User.findById(targetUserId).lean();
    if (!targetUser || targetUser.openid !== counterpartOpenid) {
      throw new Error("聊天对象不正确");
    }
  } else {
    targetUser = await User.findOne({ openid: counterpartOpenid }).lean();
  }

  if (!targetUser) {
    throw new Error("聊天对象不存在");
  }

  return {
    currentUser,
    targetUser,
    order,
  };
}

async function requireChatSessionAccess(currentOpenid, sessionId) {
  const currentUser = await getCurrentUser(currentOpenid);
  if (!currentUser) {
    throw new Error("用户不存在，请重新登录");
  }

  const session = await ChatSession.findById(sessionId).lean();
  if (!session) {
    throw new Error("聊天会话不存在");
  }

  if (!Array.isArray(session.participantOpenIds)) {
    throw new Error("聊天会话数据异常");
  }

  if (!session.participantOpenIds.includes(currentOpenid)) {
    throw new Error("你无权访问该聊天会话");
  }

  const order = await Order.findById(session.orderId).lean();
  if (!order) {
    throw new Error("关联订单不存在");
  }

  const users = await User.find({
    openid: { $in: session.participantOpenIds },
  }).lean();
  const userMap = users.reduce((result, item) => {
    result[item.openid] = item;
    return result;
  }, {});

  const counterpartOpenid = session.participantOpenIds.find(
    (item) => item !== currentOpenid,
  );
  const counterpartUser = counterpartOpenid ? userMap[counterpartOpenid] : null;

  return {
    currentUser,
    session,
    order,
    counterpartUser,
  };
}

function formatChatSession(
  session,
  order,
  currentOpenid,
  counterpartUser,
  currentUser,
) {
  const unreadCounts = session.unreadCounts || {};
  return {
    id: session._id,
    sessionId: session._id,
    orderId: session.orderId || "",
    orderType: order.type || "",
    orderTypeText: TYPE_MAP[order.type] || TYPE_MAP.other,
    orderStatus: order.status || "",
    orderStatusText: STATUS_MAP[order.status] || "未知状态",
    deliveryAddress: order.deliveryAddress || "",
    pickupAddress: order.pickupAddress || "",
    rewardText: formatCurrency(order.rewardAmount),
    lastMessageText: session.lastMessageText || "开始聊天吧",
    lastMessageType: normalizeChatType(session.lastMessageType),
    lastMessageAt: Number(session.lastMessageAt || session.updatedAt || 0),
    lastMessageAtText: formatRelativeTime(
      session.lastMessageAt || session.updatedAt || 0,
    ),
    unreadCount: Number(unreadCounts[currentOpenid] || 0),
    currentUser: currentUser ? normalizeUser(currentUser) : null,
    targetUser: counterpartUser ? normalizeUser(counterpartUser) : null,
    currentRole:
      currentOpenid === order.publisherOpenId ? "publisher" : "runner",
  };
}

async function ensureChatSession(currentOpenid, payload) {
  const { currentUser, targetUser, order } = await requireChatContext(
    currentOpenid,
    payload && payload.orderId,
    payload && payload.targetUserId,
  );

  const existing = await ChatSession.findOne({ orderId: order._id }).lean();
  const participantOpenIds = [order.publisherOpenId, order.runnerOpenId].filter(
    Boolean,
  );
  const participantUserIds = [currentUser._id, targetUser._id].filter(Boolean);
  const basePatch = {
    orderId: order._id,
    participantOpenIds,
    participantUserIds,
    updatedAt: now(),
  };

  const session = existing
    ? await ChatSession.findByIdAndUpdate(
        existing._id,
        {
          $set: basePatch,
        },
        { new: true },
      ).lean()
    : await ChatSession.create({
        ...basePatch,
        lastMessageText: "",
        lastMessageType: "text",
        lastMessageAt: 0,
        lastSenderOpenId: "",
        unreadCounts: {
          [order.publisherOpenId]: 0,
          [order.runnerOpenId]: 0,
        },
        createdAt: now(),
      });

  await bindLegacyMessagesToSession(session, currentUser, targetUser);
  const refreshedSession = await ChatSession.findById(session._id).lean();

  return formatChatSession(
    refreshedSession || session,
    order,
    currentOpenid,
    targetUser,
    currentUser,
  );
}

async function getChatSessions(currentOpenid) {
  const currentUser = await getCurrentUser(currentOpenid);
  if (!currentUser) {
    throw new Error("用户不存在，请重新登录");
  }

  const sessions = await ChatSession.find({
    participantOpenIds: currentOpenid,
  })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();

  if (!sessions.length) {
    return {
      totalUnreadCount: 0,
      list: [],
    };
  }

  const orderIds = sessions.map((item) => item.orderId).filter(Boolean);
  const orders = await Order.find({ _id: { $in: orderIds } }).lean();
  const orderMap = orders.reduce((result, item) => {
    result[item._id] = item;
    return result;
  }, {});

  const userOpenids = sessions.flatMap((item) => item.participantOpenIds || []);
  const userMap = await getUsersMap(userOpenids);

  const list = sessions
    .map((session) => {
      const order = orderMap[session.orderId];
      if (!order) {
        return null;
      }
      const counterpartOpenid = (session.participantOpenIds || []).find(
        (item) => item !== currentOpenid,
      );
      const counterpartUser = counterpartOpenid
        ? userMap[counterpartOpenid]
        : null;
      return formatChatSession(
        session,
        order,
        currentOpenid,
        counterpartUser,
        currentUser,
      );
    })
    .filter(Boolean);

  return {
    totalUnreadCount: list.reduce(
      (sum, item) => sum + Number(item.unreadCount || 0),
      0,
    ),
    list,
  };
}

async function getChatMessages(currentOpenid, sessionId) {
  const { currentUser, session, order, counterpartUser } =
    await requireChatSessionAccess(currentOpenid, sessionId);

  await bindLegacyMessagesToSession(session, currentUser, counterpartUser);

  await Chat.updateMany(
    {
      sessionId,
      toUserOpenId: currentOpenid,
      readByOpenIds: { $ne: currentOpenid },
    },
    {
      $addToSet: {
        readByOpenIds: currentOpenid,
      },
    },
  );

  await ChatSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        [`unreadCounts.${currentOpenid}`]: 0,
        updatedAt: now(),
      },
    },
  );

  const refreshedSession = await ChatSession.findById(sessionId).lean();
  const messages = await Chat.find({ sessionId }).sort({ createdAt: 1 }).lean();

  return {
    session: formatChatSession(
      refreshedSession || session,
      order,
      currentOpenid,
      counterpartUser,
      currentUser,
    ),
    messages: messages.map((item) => formatChatMessage(item, currentOpenid)),
  };
}

async function sendChatMessage(currentOpenid, sessionId, payload) {
  const { currentUser, session, order, counterpartUser } =
    await requireChatSessionAccess(currentOpenid, sessionId);

  const messageType = normalizeChatType(payload && payload.type);
  const rawContent = String((payload && payload.content) || "").trim();
  const rawImageUrl = String((payload && payload.imageUrl) || "").trim();
  const content =
    messageType === "image" ? rawImageUrl || rawContent : rawContent;
  const imageUrl = messageType === "image" ? rawImageUrl || rawContent : "";

  if (!content) {
    throw new Error("消息内容不能为空");
  }

  const toUserOpenId = (session.participantOpenIds || []).find(
    (item) => item !== currentOpenid,
  );
  const toUserId = (session.participantUserIds || []).find(
    (item) => item !== currentUser._id,
  );

  const createdAt = now();
  const message = await Chat.create({
    sessionId,
    orderId: session.orderId,
    fromUserOpenId: currentOpenid,
    toUserOpenId,
    fromUserId: currentUser._id,
    toUserId: toUserId || "",
    type: messageType,
    content,
    imageUrl,
    readByOpenIds: [currentOpenid],
    createdAt,
  });

  const senderUnreadCount = Number(
    (session.unreadCounts && session.unreadCounts[currentOpenid]) || 0,
  );
  const receiverUnreadCount = Number(
    (session.unreadCounts && session.unreadCounts[toUserOpenId]) || 0,
  );

  await ChatSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        lastMessageText: buildChatPreview(messageType, content),
        lastMessageType: messageType,
        lastMessageAt: createdAt,
        lastSenderOpenId: currentOpenid,
        updatedAt: createdAt,
        unreadCounts: {
          ...(session.unreadCounts || {}),
          [currentOpenid]: senderUnreadCount,
          [toUserOpenId]: receiverUnreadCount + 1,
        },
      },
    },
  );

  await createNotification(
    toUserOpenId,
    "新聊天消息",
    `${currentUser.nickname || "校园同学"} 发来一条${
      messageType === "image" ? "图片" : "消息"
    }`,
    "chat_message",
    order._id,
  );

  return {
    session: formatChatSession(
      {
        ...session,
        lastMessageText: buildChatPreview(messageType, content),
        lastMessageType: messageType,
        lastMessageAt: createdAt,
        unreadCounts: {
          ...(session.unreadCounts || {}),
          [currentOpenid]: senderUnreadCount,
          [toUserOpenId]: receiverUnreadCount + 1,
        },
      },
      order,
      currentOpenid,
      counterpartUser,
      currentUser,
    ),
    message: formatChatMessage(message, currentOpenid),
  };
}

module.exports = {
  PLATFORM_FEE_RATE,
  TAKE_LIMIT,
  STATUS_MAP,
  PAY_STATUS_MAP,
  TYPE_MAP,
  PRICING_RULES,
  now,
  roundMoney,
  formatCurrency,
  formatTime,
  formatRelativeTime,
  getAvatarText,
  isPhone,
  getProfileState,
  normalizeUser,
  extractCampusArea,
  calculateDistanceKm,
  formatDistance,
  getEtaText,
  getPickupTimeText,
  buildTimeline,
  getSettlement,
  getPricingDetails,
  createTradeNo,
  getCurrentUser,
  getUsersMap,
  getFavoriteSet,
  createNotification,
  recordAbnormal,
  detectPublishFrequency,
  detectCancelFrequency,
  ensureTakeCount,
  appendDistanceInfo,
  resolveMediaUrl,
  enrichOrder,
  buildEnrichedOrders,
  upsertFinanceStats,
  settleOrderIfNeeded,
  uuidv4,
  User,
  Order,
  Notification,
  Favorite,
  PaymentLog,
  AbnormalLog,
  SettlementLog,
  SystemStat,
  Chat,
  ChatSession,
  ensureChatSession,
  getChatSessions,
  getChatMessages,
  sendChatMessage,
  formatChatMessage,
};

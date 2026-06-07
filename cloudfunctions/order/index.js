const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;
const PLATFORM_FEE_RATE = 0.01;
const TAKE_LIMIT = 3;

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
  helpBuy: "帮买物品",
  document: "文件资料",
  other: "其他",
};

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
  return "￥" + roundMoney(value).toFixed(2);
}

function padNumber(value) {
  return value < 10 ? "0" + value : "" + value;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return (
    [
      date.getFullYear(),
      padNumber(date.getMonth() + 1),
      padNumber(date.getDate()),
    ].join("-") +
    " " +
    [padNumber(date.getHours()), padNumber(date.getMinutes())].join(":")
  );
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "刚刚";
  }

  if (diff < hour) {
    return Math.floor(diff / minute) + " 分钟前";
  }

  if (diff < day) {
    return Math.floor(diff / hour) + " 小时前";
  }

  return Math.floor(diff / day) + " 天前";
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
  if (!String((user && user.commonAddress) || "").trim())
    missingFields.push("常用地址");

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    missingText: missingFields.join("、"),
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

  if ([lat1, lon1, lat2, lon2].some((item) => Number.isNaN(item))) {
    return -1;
  }

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
  if (distance < 1) return Math.round(distance * 1000) + "m";
  return distance.toFixed(distance >= 10 ? 0 : 1) + "km";
}

function getEtaText(distanceKm) {
  const distance = Number(distanceKm);
  if (!distance || distance < 0) return "待估算";
  return "约 " + Math.max(6, Math.round(distance * 6)) + " 分钟";
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

function normalizeUser(user) {
  const profileState = getProfileState(user || {});

  return {
    id: user._id,
    openid: user.openid || user._openid || "",
    nickname: user.nickname || "校园同学",
    phone: user.phone || "",
    commonAddress: user.commonAddress || "",
    avatarTheme: user.avatarTheme || "ocean",
    avatarText: getAvatarText(user.nickname || "我"),
    slogan: user.slogan || "",
    role: user.role || "user",
    completedJobs: user.completedJobs || 0,
    averageScore: user.averageScore || 0,
    ratingText: Number(user.averageScore || 0).toFixed(1),
    profileComplete: profileState.isComplete,
    missingProfileFields: profileState.missingFields,
    missingProfileText: profileState.missingText,
  };
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

async function getUsersMap(openids) {
  const validOpenids = Array.from(new Set((openids || []).filter(Boolean)));

  if (!validOpenids.length) {
    return {};
  }

  const result = await db
    .collection("users")
    .where({
      openid: _.in(validOpenids),
    })
    .get();

  const map = {};
  result.data.forEach((item) => {
    map[item.openid || item._openid] = item;
  });
  const missingOpenids = validOpenids.filter((item) => !map[item]);

  if (missingOpenids.length) {
    const legacyResult = await db
      .collection("users")
      .where({
        _openid: _.in(missingOpenids),
      })
      .get();

    legacyResult.data.forEach((item) => {
      map[item.openid || item._openid] = item;
    });
  }
  return map;
}

async function getFavoriteSet(openid, orderIds) {
  const validIds = Array.from(new Set((orderIds || []).filter(Boolean)));

  if (!validIds.length) {
    return new Set();
  }

  const result = await db
    .collection("favorites")
    .where({
      userOpenId: openid,
      orderId: _.in(validIds),
    })
    .get();

  return new Set(result.data.map((item) => item.orderId));
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

async function recordAbnormal(userOpenId, type, reason, extra) {
  await db.collection("abnormal_logs").add({
    data: {
      userOpenId,
      type,
      reason,
      extra: extra || {},
      createdAt: Date.now(),
    },
  });
}

async function detectPublishFrequency(userOpenId) {
  const result = await db
    .collection("orders")
    .where({
      publisherOpenId: userOpenId,
      createdAt: _.gte(Date.now() - 10 * 60 * 1000),
    })
    .count();

  if (result.total >= 5) {
    await recordAbnormal(
      userOpenId,
      "publish_frequency",
      "10 分钟内发布订单过多",
      {
        count: result.total,
      },
    );
  }
}

async function detectCancelFrequency(userOpenId) {
  const result = await db
    .collection("orders")
    .where({
      publisherOpenId: userOpenId,
      status: "cancelled",
      cancelledAt: _.gte(Date.now() - 24 * 60 * 60 * 1000),
    })
    .count();

  if (result.total >= 3) {
    await recordAbnormal(
      userOpenId,
      "cancel_frequency",
      "24 小时内取消订单过多",
      {
        count: result.total,
      },
    );
  }
}

async function ensureTakeCount(openid) {
  const result = await db
    .collection("orders")
    .where({
      runnerOpenId: openid,
      status: _.in(["accepted", "delivered"]),
    })
    .count();

  if (result.total >= TAKE_LIMIT) {
    throw new Error("当前最多只能同时承接 " + TAKE_LIMIT + " 单任务");
  }
}

function appendDistanceInfo(orders, currentLocation) {
  return (orders || []).map((item) =>
    Object.assign({}, item, {
      distanceKm: calculateDistanceKm(
        currentLocation,
        item.pickupLocation || item.deliveryLocation,
      ),
    }),
  );
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

const PRICING_RULES = {
  baseReward: 2,
  largeItemFee: 1,
  helpBuyExtraFee: 0.5,
  urgentFee: 1,
};

function getPricingDetails(payload) {
  const type = String(payload.type || "takeout");
  const isLargeItem = !!payload.isLargeItem;
  const itemCount = Math.max(1, parseInt(payload.itemCount || 1, 10) || 1);
  const isUrgent = !!payload.isUrgent;
  const baseReward = PRICING_RULES.baseReward;
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

function enrichOrder(order, currentOpenid, userMap, favoriteSet) {
  const publisher = normalizeUser(userMap[order.publisherOpenId] || {});
  const runner = order.runnerOpenId
    ? normalizeUser(userMap[order.runnerOpenId] || {})
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

  return {
    id: order._id,
    _id: order._id,
    receiverName: order.receiverName,
    contactPhone: canViewContact ? order.contactPhone : "",
    contactPhoneText: canViewContact ? order.contactPhone : "接单后可见",
    type: order.type,
    typeText: TYPE_MAP[order.type],
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
    attachments: order.attachments || [],
    remark: order.remark,
    rewardAmount: roundMoney(order.rewardAmount),
    rewardText: formatCurrency(order.rewardAmount),
    platformFee: roundMoney(order.platformFee),
    platformFeeText: formatCurrency(order.platformFee),
    runnerIncome: roundMoney(order.runnerIncome),
    runnerIncomeText: formatCurrency(order.runnerIncome),
    status: order.status,
    statusText: STATUS_MAP[order.status],
    payStatus: order.payStatus,
    payStatusText: PAY_STATUS_MAP[order.payStatus] || "未知",
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
    roleText: isMine ? "我发布的" : "我承接的",
    canAccept,
    canCancel,
    canComplete,
    canUploadProof,
    canPay,
    canRate,
    hasAction: canCancel || canComplete || canUploadProof || canPay,
    showOrderEntry:
      !canAccept && !canCancel && !canComplete && !canUploadProof && !canPay,
    isCollected: favoriteSet.has(order._id),
    publisher,
    publisherSloganText: publisher.slogan || "已接入微信登录用户档案",
    runner,
    runnerPhoneText:
      runner && canViewContact && runner.phone
        ? runner.phone
        : runner
          ? "接单后可见"
          : "未完善",
    runnerScoreText: runner ? runner.averageScore || 0 : 0,
    runnerCompletedJobsText: runner ? runner.completedJobs || 0 : 0,
    deliveryProof: order.deliveryProof || null,
    proofNoteText:
      order.deliveryProof && order.deliveryProof.note
        ? order.deliveryProof.note
        : "已上传送达照片",
    rating: order.rating || null,
    timeline: buildTimeline(order),
  };
}

async function buildEnrichedOrders(orders, currentOpenid) {
  const openids = [];
  const ids = [];

  orders.forEach((item) => {
    openids.push(item.publisherOpenId);
    openids.push(item.runnerOpenId);
    ids.push(item._id);
  });

  const userMap = await getUsersMap(openids);
  const favoriteSet = await getFavoriteSet(currentOpenid, ids);

  return orders.map((item) =>
    enrichOrder(item, currentOpenid, userMap, favoriteSet),
  );
}

async function getHomeData(openid) {
  const currentUser = normalizeUser((await getCurrentUser(openid)) || {});
  const userResult = await db
    .collection("users")
    .orderBy("completedJobs", "desc")
    .limit(10)
    .get();
  const hotRunners = userResult.data
    .filter((item) => (item.openid || item._openid) !== openid)
    .sort((a, b) => {
      if ((b.averageScore || 0) !== (a.averageScore || 0)) {
        return (b.averageScore || 0) - (a.averageScore || 0);
      }

      return (b.completedJobs || 0) - (a.completedJobs || 0);
    })
    .slice(0, 3)
    .map(normalizeUser);

  const pendingCount = await db
    .collection("orders")
    .where({
      status: "pending",
      payStatus: "paid",
    })
    .count();
  const completedCount = await db
    .collection("orders")
    .where({
      status: "completed",
    })
    .count();

  return {
    currentUser,
    notices: [
      "赏金先托管，订单完成后再自动结算",
      "资料完善后才可发单和接单",
      "任务大厅仅展示 5km 内且已支付的订单",
    ],
    priceReference: [
      { id: "p1", scene: "食堂 / 宿舍", price: "￥2 起", tip: "近距离顺路单" },
      {
        id: "p2",
        scene: "快递驿站 / 宿舍",
        price: "￥3-6",
        tip: "按重量和楼层浮动",
      },
      {
        id: "p3",
        scene: "帮买 / 文件加急",
        price: "￥4-10",
        tip: "按路线和时效参考",
      },
    ],
    hotAreas: [
      { id: "a1", name: "东区驿站", desc: "快递代拿需求高频" },
      { id: "a2", name: "二食堂", desc: "外卖顺路单集中" },
      { id: "a3", name: "北区宿舍", desc: "晚间送达订单较多" },
    ],
    banners: [
      {
        id: "b1",
        className: "banner-blue",
        title: "赏金托管后再接单",
        desc: "订单先支付到平台托管，跑腿员完成任务后再自动结算收益。",
        tip: "资金链已接入",
      },
      {
        id: "b2",
        className: "banner-green",
        title: "拍照送达更放心",
        desc: "接单者完成前需上传送达照片，订单过程更清晰可追踪。",
        tip: "履约更透明",
      },
      {
        id: "b3",
        className: "banner-orange",
        title: "接单上限 3 单",
        desc: "自动限制同一用户同时接单数量，避免恶意抢单与履约拥堵。",
        tip: "风控规则已开启",
      },
    ],
    guides: [
      {
        id: "g1",
        title: "发布并支付",
        desc: "填写完整信息、备注必填，提交后立即托管赏金。",
        step: "01",
      },
      {
        id: "g2",
        title: "跑腿员接单",
        desc: "仅已支付订单可进入待接单列表，且同一接单者最多 3 单。",
        step: "02",
      },
      {
        id: "g3",
        title: "拍照送达",
        desc: "跑腿员上传送达照片后才能完成订单。",
        step: "03",
      },
      {
        id: "g4",
        title: "收益结算",
        desc: "平台自动抽成 1%，跑腿收益进入余额，可发起提现。",
        step: "04",
      },
    ],
    hotRunners,
    summary: {
      pendingTasks: pendingCount.total,
      completedTasks: completedCount.total,
      runnerCount: hotRunners.length,
    },
  };
}

async function toggleFavorite(openid, orderId) {
  const result = await db
    .collection("favorites")
    .where({
      userOpenId: openid,
      orderId,
    })
    .limit(1)
    .get();

  if (result.data.length) {
    await db.collection("favorites").doc(result.data[0]._id).remove();
    return {
      isCollected: false,
    };
  }

  await db.collection("favorites").add({
    data: {
      userOpenId: openid,
      orderId,
      createdAt: Date.now(),
    },
  });

  return {
    isCollected: true,
  };
}

async function getTaskList(openid, currentLocation) {
  const result = await db
    .collection("orders")
    .where({
      status: "pending",
      payStatus: "paid",
    })
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  const list = appendDistanceInfo(result.data, currentLocation)
    .filter((item) => item.distanceKm < 0 || item.distanceKm <= 5)
    .sort((a, b) => {
      if (
        a.distanceKm > 0 &&
        b.distanceKm > 0 &&
        a.distanceKm !== b.distanceKm
      ) {
        return a.distanceKm - b.distanceKm;
      }

      return b.createdAt - a.createdAt;
    });

  return {
    total: list.length,
    list: await buildEnrichedOrders(list, openid),
  };
}

async function getTaskDetail(openid, orderId) {
  const result = await db.collection("orders").doc(orderId).get();
  return (await buildEnrichedOrders([result.data], openid))[0];
}

async function acceptTask(openid, orderId, currentLocation) {
  const currentUser = await getCurrentUser(openid);
  const profileState = getProfileState(currentUser || {});

  if (!currentUser) {
    throw new Error("用户不存在，请重新登录");
  }
  if (!profileState.isComplete) {
    throw new Error("请先完善个人资料：" + profileState.missingText);
  }

  await ensureTakeCount(openid);

  const result = await db.collection("orders").doc(orderId).get();
  const order = result.data;

  if (order.publisherOpenId === openid) {
    throw new Error("不能承接自己发布的订单");
  }

  if (order.status !== "pending" || order.payStatus !== "paid") {
    throw new Error("该订单当前不可接单");
  }

  const distanceKm = calculateDistanceKm(
    currentLocation,
    order.pickupLocation || order.deliveryLocation,
  );
  if (distanceKm > 5) {
    throw new Error("只能接 5km 以内的订单");
  }

  await db
    .collection("orders")
    .doc(orderId)
    .update({
      data: {
        runnerOpenId: openid,
        status: "accepted",
        distanceKm,
        acceptedAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

  await createNotification(
    order.publisherOpenId,
    "接单提醒",
    (currentUser.nickname || "有同学") +
      " 已接单你的代拿订单，请保持联系方式畅通。",
    "order_accept",
    orderId,
  );
  return getTaskDetail(openid, orderId);
}

async function upsertFinanceStats(totalFee, platformFee, runnerIncome) {
  try {
    await db
      .collection("system_stats")
      .doc("finance")
      .update({
        data: {
          totalVolume: _.inc(roundMoney(totalFee)),
          platformIncome: _.inc(roundMoney(platformFee)),
          totalRunnerIncome: _.inc(roundMoney(runnerIncome)),
          updatedAt: Date.now(),
        },
      });
  } catch (error) {
    await db
      .collection("system_stats")
      .doc("finance")
      .set({
        data: {
          totalVolume: roundMoney(totalFee),
          platformIncome: roundMoney(platformFee),
          totalRunnerIncome: roundMoney(runnerIncome),
          updatedAt: Date.now(),
        },
      });
  }
}

async function cancelOrder(openid, orderId) {
  const result = await db.collection("orders").doc(orderId).get();
  const order = result.data;

  if (order.publisherOpenId !== openid) {
    throw new Error("仅发布者可以取消订单");
  }

  if (order.status !== "pending") {
    throw new Error("只能取消未接单订单");
  }

  const refundStatus = order.payStatus === "paid" ? "refund_review" : "";

  await db
    .collection("orders")
    .doc(orderId)
    .update({
      data: {
        status: "cancelled",
        refundStatus,
        cancelledAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

  if (order.runnerOpenId) {
    await createNotification(
      order.runnerOpenId,
      "订单已取消",
      "发布者已取消该订单，请留意订单状态变更。",
      "order_cancel",
      orderId,
    );
  }

  await detectCancelFrequency(openid);
  return getTaskDetail(openid, orderId);
}

async function rateRunner(openid, orderId, payload) {
  const score = Number(payload.score || 0);
  const comment = (payload.comment || "").trim();
  const result = await db.collection("orders").doc(orderId).get();
  const order = result.data;

  if (order.publisherOpenId !== openid) {
    throw new Error("仅发布者可以评价跑腿员");
  }

  if (order.status !== "completed") {
    throw new Error("订单完成后才能评价");
  }

  if (!order.runnerOpenId) {
    throw new Error("当前订单没有接单者，无法评价");
  }

  if (order.rating) {
    throw new Error("该订单已评价");
  }

  if (score < 1 || score > 5) {
    throw new Error("评分需在 1 到 5 分之间");
  }

  const rating = {
    score,
    comment,
    createdAt: Date.now(),
  };

  await db
    .collection("orders")
    .doc(orderId)
    .update({
      data: {
        rating,
        updatedAt: Date.now(),
      },
    });

  const ratingOrders = await db
    .collection("orders")
    .where({
      runnerOpenId: order.runnerOpenId,
      status: "completed",
      rating: _.neq(null),
    })
    .get();

  const totalScore = ratingOrders.data.reduce((sum, item) => {
    return sum + Number(item.rating ? item.rating.score : 0);
  }, 0);
  const averageScore = ratingOrders.data.length
    ? roundMoney(totalScore / ratingOrders.data.length)
    : 0;

  const runnerRecord = await getCurrentUser(order.runnerOpenId);

  if (runnerRecord) {
    await db
      .collection("users")
      .doc(runnerRecord._id)
      .update({
        data: {
          averageScore,
          updatedAt: Date.now(),
        },
      });
  }

  await createNotification(
    order.runnerOpenId,
    "收到新的评价",
    "你收到一条新的跑腿服务评分。",
    "rating",
    orderId,
  );
  return getTaskDetail(openid, orderId);
}

async function getMineData(openid) {
  const profile = normalizeUser((await getCurrentUser(openid)) || {});
  const publishedResult = await db
    .collection("orders")
    .where({
      publisherOpenId: openid,
    })
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();
  const acceptedResult = await db
    .collection("orders")
    .where({
      runnerOpenId: openid,
    })
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const publishedOrders = publishedResult.data;
  const acceptedOrders = acceptedResult.data;
  const relatedOrders = publishedOrders
    .concat(acceptedOrders)
    .filter((item, index, list) => {
      return list.findIndex((target) => target._id === item._id) === index;
    });
  const enrichedPublished = await buildEnrichedOrders(
    publishedOrders.slice(0, 3),
    openid,
  );
  const enrichedAccepted = await buildEnrichedOrders(
    acceptedOrders.slice(0, 3),
    openid,
  );
  const notifications = await db
    .collection("notifications")
    .where({
      userOpenId: openid,
    })
    .orderBy("createdAt", "desc")
    .limit(3)
    .get();
  const favoriteCount = await db
    .collection("favorites")
    .where({
      userOpenId: openid,
    })
    .count();

  return {
    profile,
    stats: {
      publishedCount: publishedOrders.length,
      acceptedCount: acceptedOrders.length,
      income: formatCurrency(
        acceptedOrders
          .filter((item) => item.status === "completed")
          .reduce((sum, item) => sum + Number(item.runnerIncome || 0), 0),
      ),
      spending: formatCurrency(
        publishedOrders
          .filter((item) => item.status === "completed")
          .reduce((sum, item) => sum + Number(item.rewardAmount || 0), 0),
      ),
      pendingCount: publishedOrders.filter((item) => item.status === "pending")
        .length,
      processingCount: relatedOrders.filter((item) =>
        ["accepted", "delivered"].includes(item.status),
      ).length,
    },
    publishedTasks: enrichedPublished,
    acceptedTasks: enrichedAccepted,
    notifications: notifications.data.map((item) => ({
      id: item._id,
      title: item.title,
      content: item.content,
      read: item.read,
      createdAtText: formatRelativeTime(item.createdAt),
    })),
    collectionCount: favoriteCount.total,
    unreadCount: notifications.data.filter((item) => !item.read).length,
  };
}

async function getOrderList(openid, status) {
  const publishedResult = await db
    .collection("orders")
    .where({
      publisherOpenId: openid,
    })
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  const acceptedResult = await db
    .collection("orders")
    .where({
      runnerOpenId: openid,
    })
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  const merged = publishedResult.data
    .concat(acceptedResult.data)
    .filter((item, index, list) => {
      return list.findIndex((target) => target._id === item._id) === index;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const counts = {
    pending: merged.filter((item) => item.status === "pending").length,
    accepted: merged.filter((item) =>
      ["accepted", "delivered"].includes(item.status),
    ).length,
    completed: merged.filter((item) => item.status === "completed").length,
    cancelled: merged.filter((item) => item.status === "cancelled").length,
  };

  const filtered = merged.filter((item) => {
    if (!status || status === "all") {
      return true;
    }

    if (status === "accepted") {
      return ["accepted", "delivered"].includes(item.status);
    }

    return item.status === status;
  });

  return {
    counts,
    list: await buildEnrichedOrders(filtered, openid),
  };
}

async function publishOrder(openid, payload) {
  const currentUser = await getCurrentUser(openid);
  const profileState = getProfileState(currentUser || {});

  if (!currentUser || !profileState.isComplete) {
    throw new Error(
      "请先完善个人资料：" +
        (profileState.missingText || "昵称、手机号、常用地址"),
    );
  }

  if (!payload.receiverName || !payload.receiverName.trim()) {
    throw new Error("请填写收件人姓名");
  }

  if (!isPhone(payload.contactPhone || "")) {
    throw new Error("请填写正确的手机号");
  }

  if (!payload.pickupAddress || !payload.pickupAddress.trim()) {
    throw new Error("请填写取件地址");
  }

  if (!payload.deliveryAddress || !payload.deliveryAddress.trim()) {
    throw new Error("请填写送达地址");
  }

  if (!payload.remark || !payload.remark.trim()) {
    throw new Error("备注信息为必填项");
  }

  if (payload.pickupAddress.trim() === payload.deliveryAddress.trim()) {
    throw new Error("取件地址和送达地址不能相同");
  }

  const pricing = getPricingDetails(payload);
  const orderNo = createTradeNo("ORD");
  const outTradeNo = createTradeNo("WX");

  const addResult = await db.collection("orders").add({
    data: {
      publisherOpenId: openid,
      receiverName: payload.receiverName.trim(),
      contactPhone: payload.contactPhone.trim(),
      type: pricing.type,
      pickupAddress: payload.pickupAddress.trim(),
      deliveryAddress: payload.deliveryAddress.trim(),
      pickupLocation: payload.pickupLocation || null,
      deliveryLocation: payload.deliveryLocation || null,
      campusAreaText: extractCampusArea(payload.pickupAddress),
      pickupTimeType: payload.pickupTimeType || "asap",
      pickupTimeValue: payload.pickupTimeValue || "",
      deliveryBuilding: String(payload.deliveryBuilding || "").trim(),
      deliveryRoom: String(payload.deliveryRoom || "").trim(),
      attachments: Array.isArray(payload.attachments)
        ? payload.attachments.slice(0, 3)
        : [],
      remark: payload.remark.trim(),
      rewardAmount: pricing.rewardAmount,
      platformFee: pricing.platformFee,
      runnerIncome: pricing.runnerIncome,
      baseReward: pricing.baseReward,
      isLargeItem: pricing.isLargeItem,
      itemCount: pricing.itemCount,
      isUrgent: pricing.isUrgent,
      pricingSnapshot: pricing.pricingSnapshot,
      payStatus: "unpaid",
      paymentMode: "",
      orderNo,
      outTradeNo,
      refundStatus: "",
      status: "pending",
      runnerOpenId: "",
      rating: null,
      deliveryProof: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  await detectPublishFrequency(openid);
  const order = await db.collection("orders").doc(addResult._id).get();
  return (await buildEnrichedOrders([order.data], openid))[0];
}

async function uploadDeliveryProof(openid, orderId, fileID, note) {
  if (!fileID) {
    throw new Error("请先上传送达照片");
  }

  const result = await db.collection("orders").doc(orderId).get();
  const order = result.data;

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.runnerOpenId !== openid) {
    throw new Error("仅接单者可上传送达照片");
  }

  if (order.status !== "accepted") {
    throw new Error("当前订单状态不能上传送达照片");
  }

  const deliveryProof = {
    fileID,
    note: note || "",
    uploadedAt: Date.now(),
  };

  try {
    if (order.deliveryProof === null) {
      await db
        .collection("orders")
        .doc(orderId)
        .update({
          data: {
            deliveryProof: _.remove(),
            updatedAt: Date.now(),
          },
        });
    }

    await db
      .collection("orders")
      .doc(orderId)
      .update({
        data: {
          deliveryProof,
          status: "delivered",
          deliveredAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
  } catch (error) {
    await recordAbnormal(openid, "upload_delivery_proof_fail", error.message, {
      orderId,
      fileID,
      stage: "db_update",
    });
    throw new Error(`上传凭证失败: ${error.message}`);
  }

  await createNotification(
    order.publisherOpenId,
    "送达照片已上传",
    "接单者已上传送达照片，订单可继续完成结算。",
    "delivery_proof",
    orderId,
  );
  return getTaskDetail(openid, orderId);
}

async function settleOrderIfNeeded(orderId, order, runnerUser, publisherUser) {
  const settlementRef = db.collection("settlement_logs").doc(orderId);

  try {
    const settlement = await settlementRef.get();
    if (settlement.data && settlement.data.status === "settled") {
      return settlement.data;
    }
  } catch (error) {
    // ignore not found
  }

  await db
    .collection("users")
    .doc(runnerUser._id)
    .update({
      data: {
        walletBalance: _.inc(roundMoney(order.runnerIncome)),
        totalIncome: _.inc(roundMoney(order.runnerIncome)),
        completedJobs: _.inc(1),
        updatedAt: Date.now(),
      },
    });

  if (publisherUser) {
    await db
      .collection("users")
      .doc(publisherUser._id)
      .update({
        data: {
          totalSpending: _.inc(roundMoney(order.rewardAmount)),
          updatedAt: Date.now(),
        },
      });
  }

  await upsertFinanceStats(
    order.rewardAmount,
    order.platformFee,
    order.runnerIncome,
  );

  await settlementRef.set({
    data: {
      orderId,
      runnerOpenId: order.runnerOpenId,
      publisherOpenId: order.publisherOpenId,
      rewardAmount: roundMoney(order.rewardAmount),
      platformFee: roundMoney(order.platformFee),
      runnerIncome: roundMoney(order.runnerIncome),
      status: "settled",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  return {
    orderId,
    status: "settled",
  };
}

async function completeOrder(openid, orderId) {
  const runner = await getCurrentUser(openid);
  const result = await db.collection("orders").doc(orderId).get();
  const order = result.data;

  if (!order) {
    throw new Error("订单不存在");
  }

  if (order.runnerOpenId !== openid) {
    throw new Error("仅接单者可完成订单");
  }

  if (order.status !== "delivered" && order.status !== "completed") {
    throw new Error("请先上传送达照片");
  }

  if (!runner) {
    throw new Error("接单者信息不存在");
  }

  const publisherUser = await getCurrentUser(order.publisherOpenId);
  await settleOrderIfNeeded(orderId, order, runner, publisherUser);

  if (order.status !== "completed") {
    await db
      .collection("orders")
      .doc(orderId)
      .update({
        data: {
          status: "completed",
          completedAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
  }

  await createNotification(
    order.publisherOpenId,
    "订单已完成",
    `${runner.nickname || "接单者"} 已完成你的订单，赏金已自动结算。`,
    "order_complete",
    orderId,
  );
  return getTaskDetail(openid, orderId);
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;

  try {
    switch (event.action) {
      case "getHomeData":
        return success(await getHomeData(openid));
      case "publish":
        return success(await publishOrder(openid, event.payload || {}));
      case "toggleFavorite":
        return success(await toggleFavorite(openid, event.orderId));
      case "getTaskList":
        return success(
          await getTaskList(openid, event.currentLocation || null),
        );
      case "getTaskDetail":
        return success(await getTaskDetail(openid, event.orderId));
      case "acceptTask":
        return success(
          await acceptTask(
            openid,
            event.orderId,
            event.currentLocation || null,
          ),
        );
      case "uploadDeliveryProof":
        return success(
          await uploadDeliveryProof(
            openid,
            event.orderId,
            event.fileID,
            event.note,
          ),
        );
      case "completeOrder":
        return success(await completeOrder(openid, event.orderId));
      case "cancelOrder":
        return success(await cancelOrder(openid, event.orderId));
      case "rateRunner":
        return success(
          await rateRunner(openid, event.orderId, event.payload || {}),
        );
      case "getMineData":
        return success(await getMineData(openid));
      case "getOrderList":
        return success(await getOrderList(openid, event.status));
      default:
        return fail("不支持的操作类型");
    }
  } catch (error) {
    return fail(error.message || "云函数执行失败");
  }
};

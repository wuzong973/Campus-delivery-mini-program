const { publicBaseUrl } = require("../config/env");
const {
  applyRefund,
  syncRemotePaymentStatusByOrder,
  syncRemoteRefundStatusByOrder,
} = require("./paymentService");
const {
  TYPE_MAP,
  PLATFORM_FEE_RATE,
  now,
  roundMoney,
  formatCurrency,
  formatRelativeTime,
  getProfileState,
  getPricingDetails,
  extractCampusArea,
  createTradeNo,
  getCurrentUser,
  getUsersMap,
  createNotification,
  detectPublishFrequency,
  detectCancelFrequency,
  ensureTakeCount,
  appendDistanceInfo,
  buildEnrichedOrders,
  calculateDistanceKm,
  recordAbnormal,
  settleOrderIfNeeded,
  User,
  Order,
  Favorite,
  Notification,
} = require("./shared");

async function requireCurrentUser(openid) {
  const user = await getCurrentUser(openid);
  if (!user) {
    throw new Error("用户不存在，请重新登录");
  }
  return user;
}

function requireCompletedProfile(user) {
  const profileState = getProfileState(user || {});
  if (!profileState.isComplete) {
    throw new Error(`请先完善个人资料：${profileState.missingText}`);
  }
}

function buildHomeData(currentUser, hotRunners, pendingTasks, completedTasks) {
  return {
    currentUser,
    notices: [
      "赏金先托管，订单完成后再自动结算",
      "资料完善后才可发单和接单",
      "任务大厅仅展示 5km 内且已支付的订单",
    ],
    priceReference: [
      { id: "p1", scene: "食堂 / 宿舍", price: "¥2 起", tip: "近距离顺路单" },
      {
        id: "p2",
        scene: "快递 / 宿舍",
        price: "¥3-6",
        tip: "按重量和楼层浮动",
      },
      {
        id: "p3",
        scene: "帮买 / 加急",
        price: "¥3-10",
        tip: "按路线和时效参考",
      },
    ],
    hotAreas: [
      { id: "a1", name: "东区驿站", desc: "快递代拿需求较多" },
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
        title: "接单上限 10 单",
        desc: "自动限制同一用户同时接单数量，避免恶意抢单与履约拥堵。",
        tip: "风控规则已开启",
      },
      {
        id: "b4",
        className: "banner-blank",
        title: "若没有显示新功能的先删除小程序再搜索进入",
        desc: "点击首页的“浏览任务”即可无门槛接单；接单后发布者和接单者之间可直接线上对话",
        tip: "本次更新：",
      },
    ],
    guides: [
      {
        id: "g1",
        title: "发布需求",
        desc: "填写取送地址、备注并支付托管赏金。",
      },
      { id: "g2", title: "等待接单", desc: "任务大厅会展示给附近可接单用户。" },
      { id: "g3", title: "拍照送达", desc: "接单者完成后上传凭证并结算收益。" },
    ],
    hotRunners,
    summary: {
      pendingTasks,
      completedTasks,
      runnerCount: hotRunners.length,
    },
  };
}

async function getHomeData(openid) {
  const currentUser = await requireCurrentUser(openid);
  const hotRunnerDocs = await User.find({})
    .sort({ completedJobs: -1, averageScore: -1 })
    .limit(10)
    .lean();

  const hotRunners = hotRunnerDocs
    .filter((item) => item.openid !== openid)
    .sort((a, b) => {
      if (Number(b.averageScore || 0) !== Number(a.averageScore || 0)) {
        return Number(b.averageScore || 0) - Number(a.averageScore || 0);
      }
      return Number(b.completedJobs || 0) - Number(a.completedJobs || 0);
    })
    .slice(0, 3)
    .map((item) => ({
      id: item._id,
      openid: item.openid,
      nickname: item.nickname || "校园同学",
      avatarText: (item.nickname || "我").slice(0, 1),
      avatarTheme: item.avatarTheme || "ocean",
      slogan: item.slogan || "",
      completedJobs: Number(item.completedJobs || 0),
      averageScore: Number(item.averageScore || 0),
      ratingText: Number(item.averageScore || 0).toFixed(1),
    }));

  const [pendingTasks, completedTasks] = await Promise.all([
    Order.countDocuments({ status: "pending", payStatus: "paid" }),
    Order.countDocuments({ status: "completed" }),
  ]);

  return buildHomeData(
    {
      ...currentUser,
      avatarText: (currentUser.nickname || "我").slice(0, 1),
    },
    hotRunners,
    pendingTasks,
    completedTasks,
  );
}

async function createOrder(openid, payload) {
  const currentUser = await requireCurrentUser(openid);
  requireCompletedProfile(currentUser);

  if (!String(payload.receiverName || "").trim()) {
    throw new Error("请填写收件人姓名");
  }
  if (!String(payload.contactPhone || "").trim()) {
    throw new Error("请填写联系方式");
  }
  if (!String(payload.pickupAddress || "").trim()) {
    throw new Error("请填写取件地址");
  }
  if (!String(payload.deliveryAddress || "").trim()) {
    throw new Error("请填写送达地址");
  }
  if (!String(payload.remark || "").trim()) {
    throw new Error("备注信息为必填项");
  }
  if (
    String(payload.pickupAddress || "").trim() ===
    String(payload.deliveryAddress || "").trim()
  ) {
    throw new Error("取件地址和送达地址不能相同");
  }

  const pricing = getPricingDetails(payload);
  if (
    payload.rewardAmount &&
    Math.abs(payload.rewardAmount - pricing.rewardAmount) > 0.01
  ) {
    recordAbnormal(openid, "price_discrepancy", "价格计算不一致", {
      frontend: payload.rewardAmount,
      backend: pricing.rewardAmount,
      payload,
    });
  }

  const orderNo = createTradeNo("ORD");
  const outTradeNo = createTradeNo("WX");

  const created = await Order.create({
    publisherOpenId: openid,
    receiverName: String(payload.receiverName || "").trim(),
    contactPhone: String(payload.contactPhone || "").trim(),
    type: pricing.type,
    pickupAddress: String(payload.pickupAddress || "").trim(),
    deliveryAddress: String(payload.deliveryAddress || "").trim(),
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
    remark: String(payload.remark || "").trim(),
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
    createdAt: now(),
    updatedAt: now(),
  });

  await detectPublishFrequency(openid);
  return getTaskDetail(openid, created._id);
}

async function toggleFavorite(openid, orderId) {
  const existing = await Favorite.findOne({
    userOpenId: openid,
    orderId,
  }).lean();

  if (existing) {
    await Favorite.deleteOne({ _id: existing._id });
    return {
      isCollected: false,
    };
  }

  await Favorite.create({
    userOpenId: openid,
    orderId,
    createdAt: now(),
  });

  return {
    isCollected: true,
  };
}

async function getTaskList(openid, currentLocation) {
  const rows = await Order.find({
    status: "pending",
    payStatus: "paid",
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const list = appendDistanceInfo(rows, currentLocation)
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
    list: await buildEnrichedOrders(list, openid, publicBaseUrl),
  };
}

async function getTaskDetail(openid, orderId) {
  let order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }
  if (
    order.publisherOpenId === openid &&
    order.status === "pending" &&
    order.payStatus !== "paid" &&
    order.outTradeNo
  ) {
    await syncRemotePaymentStatusByOrder(order);
    order = await Order.findById(orderId).lean();
  }
  if (order.refundStatus && order.outRefundNo) {
    await syncRemoteRefundStatusByOrder(order);
    order = await Order.findById(orderId).lean();
  }
  const list = await buildEnrichedOrders([order], openid, publicBaseUrl);
  return list[0];
}

async function acceptTask(openid, orderId, currentLocation) {
  const currentUser = await requireCurrentUser(openid);
  requireCompletedProfile(currentUser);
  await ensureTakeCount(openid);

  const order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }
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
    throw new Error("只能接 5km 内的订单");
  }

  await Order.updateOne(
    { _id: orderId, status: "pending", payStatus: "paid" },
    {
      $set: {
        runnerOpenId: openid,
        status: "accepted",
        distanceKm,
        acceptedAt: now(),
        updatedAt: now(),
      },
    },
  );

  await createNotification(
    order.publisherOpenId,
    "接单提醒",
    `${currentUser.nickname || "有同学"} 已接单你的代拿订单，请保持联系方式畅通。`,
    "order_accept",
    orderId,
  );

  return getTaskDetail(openid, orderId);
}

async function uploadDeliveryProof(openid, orderId, proof) {
  const order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }
  if (order.runnerOpenId !== openid) {
    throw new Error("仅接单者可上传送达照片");
  }
  if (order.status !== "accepted") {
    throw new Error("当前订单状态不能上传送达照片");
  }
  if (!proof || !proof.fileID) {
    throw new Error("请先上传送达照片");
  }

  const deliveryProof = {
    fileID: proof.fileID,
    note: proof.note || "",
    uploadedAt: now(),
  };

  try {
    await Order.updateOne(
      { _id: orderId },
      {
        $set: {
          deliveryProof,
          status: "delivered",
          deliveredAt: now(),
          updatedAt: now(),
        },
      },
    );
  } catch (error) {
    await recordAbnormal(openid, "upload_delivery_proof_fail", error.message, {
      orderId,
      fileID: proof.fileID,
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

async function completeOrder(openid, orderId) {
  const runner = await requireCurrentUser(openid);
  const order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }
  if (order.runnerOpenId !== openid) {
    throw new Error("仅接单者可完成订单");
  }
  if (order.status !== "delivered" && order.status !== "completed") {
    throw new Error("请先上传送达照片");
  }

  const publisherUser = await getCurrentUser(order.publisherOpenId);
  await settleOrderIfNeeded(order, runner, publisherUser);

  if (order.status !== "completed") {
    await Order.updateOne(
      { _id: orderId },
      {
        $set: {
          status: "completed",
          completedAt: now(),
          updatedAt: now(),
        },
      },
    );
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

async function cancelOrder(openid, orderId) {
  let order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }

  const isPublisher = order.publisherOpenId === openid;
  const isRunner = order.runnerOpenId === openid;

  if (!isPublisher && !isRunner) {
    throw new Error("仅订单相关人员可以取消订单");
  }

  if (order.status !== "pending" && order.status !== "accepted") {
    throw new Error("只能取消未接单或已接单的订单");
  }

  await detectCancelFrequency(openid);

  const paymentStatus = await syncRemotePaymentStatusByOrder(order);
  const wasPaid = paymentStatus.payStatus === "paid";

  if (wasPaid) {
    try {
      await applyRefund(order);
      order = await Order.findById(orderId).lean();
    } catch (error) {
      await recordAbnormal(openid, "cancel_refund_fail", error.message, {
        orderId,
      });
      throw new Error(`取消失败，退款未发起成功：${error.message}`);
    }
  }

  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        status: "cancelled",
        refundStatus: wasPaid ? "processing" : "",
        cancelledAt: now(),
        updatedAt: now(),
      },
    },
  );

  if (isPublisher && order.runnerOpenId) {
    await createNotification(
      order.runnerOpenId,
      "订单已取消",
      "发布者已取消该订单，请留意订单状态变更。",
      "order_cancel",
      orderId,
    );
  } else if (isRunner) {
    await createNotification(
      order.publisherOpenId,
      "订单已取消",
      "接单者已取消该订单，请留意订单状态变更。",
      "order_cancel",
      orderId,
    );
  }

  return getTaskDetail(openid, orderId);
}

async function rateRunner(openid, orderId, payload) {
  const score = Number(payload.score || 0);
  const comment = String(payload.comment || "").trim();
  const order = await Order.findById(orderId).lean();
  if (!order) {
    throw new Error("订单不存在");
  }
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
    createdAt: now(),
  };

  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        rating,
        updatedAt: now(),
      },
    },
  );

  const ratingOrders = await Order.find({
    runnerOpenId: order.runnerOpenId,
    status: "completed",
    rating: { $ne: null },
  }).lean();

  const totalScore = ratingOrders.reduce(
    (sum, item) => sum + Number(item.rating ? item.rating.score : 0),
    0,
  );
  const averageScore = ratingOrders.length
    ? roundMoney(totalScore / ratingOrders.length)
    : 0;

  await User.updateOne(
    { openid: order.runnerOpenId },
    {
      $set: {
        averageScore,
        updatedAt: now(),
      },
    },
  );

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
  const user = await requireCurrentUser(openid);
  const [publishedOrders, acceptedOrders, notifications, collectionCount] =
    await Promise.all([
      Order.find({ publisherOpenId: openid })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Order.find({ runnerOpenId: openid })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Notification.find({ userOpenId: openid })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean(),
      Favorite.countDocuments({ userOpenId: openid }),
    ]);

  const relatedOrders = [...publishedOrders, ...acceptedOrders].filter(
    (item, index, list) =>
      list.findIndex((target) => target._id === item._id) === index,
  );

  const [enrichedPublished, enrichedAccepted] = await Promise.all([
    buildEnrichedOrders(publishedOrders.slice(0, 3), openid, publicBaseUrl),
    buildEnrichedOrders(acceptedOrders.slice(0, 3), openid, publicBaseUrl),
  ]);

  return {
    profile: {
      ...user,
      avatarText: (user.nickname || "我").slice(0, 1),
    },
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
    notifications: notifications.map((item) => ({
      id: item._id,
      title: item.title,
      content: item.content,
      read: !!item.read,
      createdAtText: formatRelativeTime(item.createdAt),
    })),
    collectionCount,
    unreadCount: notifications.filter((item) => !item.read).length,
  };
}

async function getOrderList(openid, status) {
  let [publishedOrders, acceptedOrders] = await Promise.all([
    Order.find({ publisherOpenId: openid })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    Order.find({ runnerOpenId: openid })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  const needSyncOrders = publishedOrders.filter(
    (item) =>
      item.status === "pending" && item.payStatus !== "paid" && item.outTradeNo,
  );

  if (needSyncOrders.length) {
    await Promise.all(
      needSyncOrders.map((item) => syncRemotePaymentStatusByOrder(item)),
    );
    [publishedOrders, acceptedOrders] = await Promise.all([
      Order.find({ publisherOpenId: openid })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Order.find({ runnerOpenId: openid })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);
  }

  const refundSyncOrders = publishedOrders.filter(
    (item) => item.refundStatus && item.outRefundNo,
  );

  if (refundSyncOrders.length) {
    await Promise.all(
      refundSyncOrders.map((item) => syncRemoteRefundStatusByOrder(item)),
    );
    [publishedOrders, acceptedOrders] = await Promise.all([
      Order.find({ publisherOpenId: openid })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Order.find({ runnerOpenId: openid })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);
  }

  const merged = [...publishedOrders, ...acceptedOrders]
    .filter(
      (item, index, list) =>
        list.findIndex((target) => target._id === item._id) === index,
    )
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
    if (!status || status === "all") return true;
    if (status === "accepted")
      return ["accepted", "delivered"].includes(item.status);
    return item.status === status;
  });

  return {
    counts,
    list: await buildEnrichedOrders(filtered, openid, publicBaseUrl),
  };
}

module.exports = {
  getHomeData,
  createOrder,
  toggleFavorite,
  getTaskList,
  getTaskDetail,
  acceptTask,
  uploadDeliveryProof,
  completeOrder,
  cancelOrder,
  rateRunner,
  getMineData,
  getOrderList,
};

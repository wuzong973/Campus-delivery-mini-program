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
  businessError,
} = require("./shared");

async function requireCurrentUser(openid) {
  const user = await getCurrentUser(openid);
  if (!user) {
    throw businessError("用户不存在，请重新登录");
  }
  return user;
}

function requireCompletedProfile(user) {
  const profileState = getProfileState(user || {});
  if (!profileState.isComplete) {
    throw businessError(`请先完善个人资料：${profileState.missingText}`);
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
    throw businessError("请填写收件人姓名");
  }
  if (!String(payload.contactPhone || "").trim()) {
    throw businessError("请填写联系方式");
  }
  if (!String(payload.pickupAddress || "").trim()) {
    throw businessError("请填写取件地址");
  }
  if (!String(payload.deliveryAddress || "").trim()) {
    throw businessError("请填写送达地址");
  }
  if (!String(payload.remark || "").trim()) {
    throw businessError("备注信息为必填项");
  }
  if (
    String(payload.pickupAddress || "").trim() ===
    String(payload.deliveryAddress || "").trim()
  ) {
    throw businessError("取件地址和送达地址不能相同");
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
    throw businessError("订单不存在");
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
    throw businessError("订单不存在");
  }
  if (order.publisherOpenId === openid) {
    throw businessError("不能承接自己发布的订单");
  }
  if (order.status !== "pending" || order.payStatus !== "paid") {
    throw businessError("该订单当前不可接单");
  }

  const distanceKm = calculateDistanceKm(
    currentLocation,
    order.pickupLocation || order.deliveryLocation,
  );
  if (distanceKm > 5) {
    throw businessError("只能接 5km 内的订单");
  }

  // 条件更新本身是原子的，但必须校验结果：两个骑手同时点接单时，
  // 只有一条 update 会命中，未命中的那个不能继续报「接单成功」。
  const claim = await Order.updateOne(
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

  if (claim.modifiedCount !== 1) {
    throw businessError("手慢了，该订单已被其他同学接走");
  }

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
    throw businessError("订单不存在");
  }
  if (order.runnerOpenId !== openid) {
    throw businessError("仅接单者可上传送达照片");
  }
  if (order.status !== "accepted") {
    throw businessError("当前订单状态不能上传送达照片");
  }
  if (!proof || !proof.fileID) {
    throw businessError("请先上传送达照片");
  }

  const deliveryProof = {
    fileID: proof.fileID,
    note: proof.note || "",
    uploadedAt: now(),
  };

  try {
    // 带状态条件的更新：防止并发下重复置为 delivered 或覆盖已变更的状态
    const claim = await Order.updateOne(
      { _id: orderId, runnerOpenId: openid, status: "accepted" },
      {
        $set: {
          deliveryProof,
          status: "delivered",
          deliveredAt: now(),
          updatedAt: now(),
        },
      },
    );

    if (claim.modifiedCount !== 1) {
      throw businessError("订单状态已变更，请刷新后重试");
    }
  } catch (error) {
    await recordAbnormal(openid, "upload_delivery_proof_fail", error.message, {
      orderId,
      fileID: proof.fileID,
      stage: "db_update",
    });
    throw businessError(`上传凭证失败: ${error.message}`);
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
    throw businessError("订单不存在");
  }
  if (order.runnerOpenId !== openid) {
    throw businessError("仅接单者可完成订单");
  }
  if (order.status !== "delivered" && order.status !== "completed") {
    throw businessError("请先上传送达照片");
  }

  // 原子抢占：只有把订单从 delivered 推到 completed 成功的那个请求才算「本次完成」。
  // 并发的第二个请求 modifiedCount 为 0，不会重复发通知、也不会走到重复结算。
  const claim = await Order.updateOne(
    { _id: orderId, runnerOpenId: openid, status: "delivered" },
    {
      $set: {
        status: "completed",
        completedAt: now(),
        updatedAt: now(),
      },
    },
  );

  const isFirstCompletion = claim.modifiedCount === 1;

  // 无论是否首次完成都调用结算：settleOrderIfNeeded 内部有独立的原子闸门，
  // 既能保证幂等，也能补偿「订单已置为 completed 但结算中断」的异常场景。
  const publisherUser = await getCurrentUser(order.publisherOpenId);
  await settleOrderIfNeeded(order, runner, publisherUser);

  if (isFirstCompletion) {
    await createNotification(
      order.publisherOpenId,
      "订单已完成",
      `${runner.nickname || "接单者"} 已完成你的订单，赏金已自动结算。`,
      "order_complete",
      orderId,
    );
  }

  return getTaskDetail(openid, orderId);
}

async function cancelOrder(openid, orderId) {
  let order = await Order.findById(orderId).lean();
  if (!order) {
    throw businessError("订单不存在");
  }

  const isPublisher = order.publisherOpenId === openid;
  const isRunner = order.runnerOpenId === openid;

  if (!isPublisher && !isRunner) {
    throw businessError("仅订单相关人员可以取消订单");
  }

  if (order.status !== "pending" && order.status !== "accepted") {
    throw businessError("只能取消未接单或已接单的订单");
  }

  await detectCancelFrequency(openid);

  const paymentStatus = await syncRemotePaymentStatusByOrder(order);
  const wasPaid = paymentStatus.payStatus === "paid";
  const previousStatus = order.status;

  // 原子抢占：只有把订单从 pending/accepted 推到 cancelled 成功的请求才继续退款。
  // 旧实现是「先读状态判断 → 调退款 → 再改状态」，两个并发取消请求都能通过检查，
  // 会各自发起一次退款，造成重复退款。
  const claim = await Order.updateOne(
    { _id: orderId, status: { $in: ["pending", "accepted"] } },
    {
      $set: {
        status: "cancelled",
        cancelledAt: now(),
        updatedAt: now(),
      },
    },
  );

  if (claim.modifiedCount !== 1) {
    throw businessError("订单状态已变更，请刷新后重试");
  }

  if (wasPaid) {
    try {
      await applyRefund(order);
      order = await Order.findById(orderId).lean();
    } catch (error) {
      // 退款发起失败时把订单状态回滚，避免出现「已取消但没退款」的悬空状态，
      // 用户可重新发起取消。
      await Order.updateOne(
        { _id: orderId, status: "cancelled" },
        {
          $set: {
            status: previousStatus,
            cancelledAt: 0,
            updatedAt: now(),
          },
        },
      );
      await recordAbnormal(openid, "cancel_refund_fail", error.message, {
        orderId,
      });
      throw businessError(`取消失败，退款未发起成功：${error.message}`);
    }
  }

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
    throw businessError("订单不存在");
  }
  if (order.publisherOpenId !== openid) {
    throw businessError("仅发布者可以评价跑腿员");
  }
  if (order.status !== "completed") {
    throw businessError("订单完成后才能评价");
  }
  if (!order.runnerOpenId) {
    throw businessError("当前订单没有接单者，无法评价");
  }
  if (order.rating) {
    throw businessError("该订单已评价");
  }
  if (score < 1 || score > 5) {
    throw businessError("评分需在 1 到 5 分之间");
  }

  const rating = {
    score,
    comment,
    createdAt: now(),
  };

  // 条件更新：rating 为空才写入，避免并发下重复评价、重复发通知
  const claim = await Order.updateOne(
    { _id: orderId, rating: null },
    {
      $set: {
        rating,
        updatedAt: now(),
      },
    },
  );

  if (claim.modifiedCount !== 1) {
    throw businessError("该订单已评价");
  }

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

// 订单列表的「状态归类」：delivered 在业务上等价于待完成，统一并入 accepted 分组
const ACTIVE_STATUSES = ["accepted", "delivered"];

function buildOrderQuery(openid, role, status) {
  const query = {};

  if (role === "published") {
    query.publisherOpenId = openid;
  } else if (role === "accepted") {
    query.runnerOpenId = openid;
  } else {
    query.$or = [{ publisherOpenId: openid }, { runnerOpenId: openid }];
  }

  if (status && status !== "all") {
    query.status = status === "accepted" ? { $in: ACTIVE_STATUSES } : status;
  }

  return query;
}

/**
 * 统计两个角色下各状态的订单数。
 * 关键点：统计覆盖该用户的**全部**订单，不受分页影响，
 * 否则用户订单超过一页时，标签上的数字会明显偏小。
 * 用一次聚合完成，避免 8 次 countDocuments。
 */
async function buildOrderCounts(openid) {
  const rows = await Order.aggregate([
    {
      $match: {
        $or: [{ publisherOpenId: openid }, { runnerOpenId: openid }],
      },
    },
    {
      $group: {
        _id: {
          role: {
            $cond: [
              { $eq: ["$publisherOpenId", openid] },
              "published",
              "accepted",
            ],
          },
          bucket: {
            $cond: [
              { $in: ["$status", ACTIVE_STATUSES] },
              "accepted",
              "$status",
            ],
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const emptyBucket = () => ({
    pending: 0,
    accepted: 0,
    completed: 0,
    cancelled: 0,
  });
  const counts = { published: emptyBucket(), accepted: emptyBucket() };

  rows.forEach((row) => {
    const role = row && row._id ? row._id.role : "";
    const bucket = row && row._id ? row._id.bucket : "";
    const target = counts[role];

    if (target && Object.prototype.hasOwnProperty.call(target, bucket)) {
      target[bucket] = Number(row.count || 0);
    }
  });

  return counts;
}

/**
 * 订单列表（支持按角色/状态筛选 + 分页）。
 *
 * @param {string} openid
 * @param {object} [options]
 * @param {string} [options.role]     "published" | "accepted" | 空（两者都查）
 * @param {string} [options.status]   "all" | "pending" | "accepted" | "completed" | "cancelled"
 * @param {number} [options.page]     页码，从 1 开始
 * @param {number} [options.pageSize] 每页条数，最大 50
 */
async function getOrderList(openid, options = {}) {
  const role = ["published", "accepted"].includes(options.role)
    ? options.role
    : "";
  const status = String(options.status || "all");
  const pageSize = Math.min(Math.max(Number(options.pageSize) || 20, 1), 50);
  const page = Math.max(Number(options.page) || 1, 1);

  const query = buildOrderQuery(openid, role, status);

  // 先对「待支付」与「退款中」的订单做一次远程状态同步，
  // 避免用户看到过期的支付/退款状态。只取最近若干条，不做全量同步。
  const staleRows = await Order.find({
    $and: [
      query,
      {
        $or: [
          {
            status: "pending",
            payStatus: { $ne: "paid" },
            outTradeNo: { $nin: ["", null] },
          },
          {
            refundStatus: { $nin: ["", null] },
            outRefundNo: { $nin: ["", null] },
          },
        ],
      },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  if (staleRows.length) {
    await Promise.all(
      staleRows.map((item) =>
        item.refundStatus && item.outRefundNo
          ? syncRemoteRefundStatusByOrder(item)
          : syncRemotePaymentStatusByOrder(item),
      ),
    );
  }

  const [total, rows, counts] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    buildOrderCounts(openid),
  ]);

  return {
    list: await buildEnrichedOrders(rows, openid, publicBaseUrl),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    counts,
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

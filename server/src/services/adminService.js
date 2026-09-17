const {
  roundMoney,
  formatTime,
  getAvatarText,
  getProfileState,
  createNotification,
  getCurrentUser,
  extractCampusArea,
  businessError,
} = require("./shared");
const {
  User,
  Order,
  AbnormalLog,
  Withdrawal,
  SystemStat,
} = require("../models");
const { manualReconcileByOrderNo } = require("./paymentService");

async function ensureAdmin(openid) {
  const user = await getCurrentUser(openid);
  if (!user || user.role !== "admin") {
    throw businessError("当前用户没有管理员权限");
  }
  return user;
}

async function getDashboard(openid) {
  await ensureAdmin(openid);

  const [
    userCount,
    orderCount,
    abnormalCount,
    pendingWithdrawals,
    users,
    orders,
    abnormalLogs,
    withdrawals,
    financeStats,
  ] = await Promise.all([
    User.countDocuments({}),
    Order.countDocuments({}),
    AbnormalLog.countDocuments({}),
    Withdrawal.countDocuments({ status: "pending" }),
    User.find({}).sort({ createdAt: -1 }).limit(30).lean(),
    Order.find({}).sort({ createdAt: -1 }).limit(40).lean(),
    AbnormalLog.find({}).sort({ createdAt: -1 }).limit(20).lean(),
    Withdrawal.find({}).sort({ createdAt: -1 }).limit(30).lean(),
    SystemStat.findById("finance").lean(),
  ]);

  const userOpenids = Array.from(
    new Set(
      []
        .concat(users.map((item) => item.openid))
        .concat(orders.map((item) => item.publisherOpenId))
        .concat(orders.map((item) => item.runnerOpenId))
        .concat(abnormalLogs.map((item) => item.userOpenId))
        .concat(withdrawals.map((item) => item.userOpenId))
        .filter(Boolean),
    ),
  );
  const relatedUsers = await User.find({ openid: { $in: userOpenids } }).lean();
  const userMap = relatedUsers.reduce((result, item) => {
    result[item.openid] = item;
    return result;
  }, {});

  return {
    summary: {
      userCount,
      orderCount,
      abnormalCount,
      pendingWithdrawals,
      totalVolumeText: `¥${roundMoney(financeStats && financeStats.totalVolume).toFixed(2)}`,
      platformIncomeText: `¥${roundMoney(financeStats && financeStats.platformIncome).toFixed(2)}`,
      totalRunnerIncomeText: `¥${roundMoney(financeStats && financeStats.totalRunnerIncome).toFixed(2)}`,
    },
    users: users.map((item) => {
      const profileState = getProfileState(item);
      return {
        id: item._id,
        nickname: item.nickname || "校园同学",
        avatarText: getAvatarText(item.nickname || "我"),
        phone: item.phone || "",
        phoneText: item.phone || "未完善",
        role: item.role || "user",
        walletBalanceText: `¥${roundMoney(item.walletBalance).toFixed(2)}`,
        totalIncomeText: `¥${roundMoney(item.totalIncome).toFixed(2)}`,
        averageScore: item.averageScore || 0,
        averageScoreText: item.averageScore || 0,
        completedJobs: item.completedJobs || 0,
        completedJobsText: item.completedJobs || 0,
        profileStatusText: profileState.isComplete ? "已完善" : "待完善",
        createdAtText: formatTime(item.createdAt),
      };
    }),
    orders: orders.map((item) => ({
      id: item._id,
      typeText: item.type === "takeout" ? "外卖" : item.type === "parcel" ? "快递" : "其他",
      status: item.status,
      payStatus: item.payStatus,
      rewardText: `¥${roundMoney(item.rewardAmount).toFixed(2)}`,
      publisherName: userMap[item.publisherOpenId] ? userMap[item.publisherOpenId].nickname : "未知用户",
      runnerName:
        item.runnerOpenId && userMap[item.runnerOpenId]
          ? userMap[item.runnerOpenId].nickname
          : "暂无",
      campusAreaText:
        item.campusAreaText ||
        extractCampusArea(item.pickupAddress || item.deliveryAddress),
      deliveryAddress: item.deliveryAddress,
      createdAtText: formatTime(item.createdAt),
    })),
    abnormalLogs: abnormalLogs.map((item) => ({
      id: item._id,
      nickname: userMap[item.userOpenId] ? userMap[item.userOpenId].nickname : "未知用户",
      type: item.type,
      reason: item.reason,
      createdAtText: formatTime(item.createdAt),
    })),
    withdrawals: withdrawals.map((item) => ({
      id: item._id,
      nickname: userMap[item.userOpenId] ? userMap[item.userOpenId].nickname : "未知用户",
      phone: userMap[item.userOpenId] ? userMap[item.userOpenId].phone || "未提供" : "未提供",
      amountText: `¥${roundMoney(item.amount).toFixed(2)}`,
      status: item.status,
      createdAtText: formatTime(item.createdAt),
    })),
  };
}

async function auditWithdrawal(openid, withdrawalId, decision) {
  await ensureAdmin(openid);
  const withdrawal = await Withdrawal.findById(withdrawalId).lean();
  if (!withdrawal) {
    throw businessError("提现单不存在");
  }
  if (withdrawal.status !== "pending") {
    throw businessError("该提现单已处理");
  }
  const user = await getCurrentUser(withdrawal.userOpenId);
  if (!user) {
    throw businessError("提现用户不存在");
  }

  if (decision === "approve") {
    await Withdrawal.updateOne(
      { _id: withdrawalId },
      {
        $set: {
          status: "paid",
          updatedAt: Date.now(),
          processedAt: Date.now(),
          processedByOpenId: openid,
          remark: "管理员已审核通过，请线下或通过商户工具完成实际打款。",
        },
      },
    );
    await User.updateOne(
      { _id: user._id },
      {
        $inc: {
          totalWithdrawn: roundMoney(withdrawal.amount),
        },
        $set: {
          updatedAt: Date.now(),
        },
      },
    );
    await createNotification(
      withdrawal.userOpenId,
      "提现已通过",
      "你的提现申请已审核通过，平台将尽快完成打款。",
      "withdrawal",
      "",
    );
  } else {
    await Withdrawal.updateOne(
      { _id: withdrawalId },
      {
        $set: {
          status: "rejected",
          updatedAt: Date.now(),
          processedAt: Date.now(),
          processedByOpenId: openid,
          remark: "管理员已驳回，本次金额已退回余额。",
        },
      },
    );
    await User.updateOne(
      { _id: user._id },
      {
        $inc: {
          walletBalance: roundMoney(withdrawal.amount),
        },
        $set: {
          updatedAt: Date.now(),
        },
      },
    );
    await createNotification(
      withdrawal.userOpenId,
      "提现已驳回",
      "你的提现申请已被驳回，金额已退回余额。",
      "withdrawal",
      "",
    );
  }

  return {
    withdrawalId,
    status: decision === "approve" ? "paid" : "rejected",
  };
}

async function reconcileOrderByNo(openid, orderNo) {
  await ensureAdmin(openid);
  return manualReconcileByOrderNo(orderNo);
}

module.exports = {
  ensureAdmin,
  getDashboard,
  auditWithdrawal,
  reconcileOrderByNo,
};

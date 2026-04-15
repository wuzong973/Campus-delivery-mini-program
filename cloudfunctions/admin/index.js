const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function success(data) {
  return {
    success: true,
    data
  };
}

function fail(message) {
  return {
    success: false,
    message
  };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getAvatarText(name) {
  return name ? String(name).trim().slice(0, 1) : '我';
}

function getProfileState(user) {
  const missingFields = [];

  if (!String(user && user.nickname || '').trim()) missingFields.push('昵称');
  if (!/^1\d{10}$/.test(String(user && user.phone || '').trim())) missingFields.push('手机号');
  if (!String(user && user.commonAddress || '').trim()) missingFields.push('常用地址');

  return {
    isComplete: missingFields.length === 0
  };
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

async function getCurrentUser(openid) {
  let result = await db.collection('users').where({
    openid
  }).limit(1).get();

  if (!result.data.length) {
    result = await db.collection('users').where({
      _openid: openid
    }).limit(1).get();
  }

  return result.data[0] || null;
}

async function ensureAdmin(openid) {
  const user = await getCurrentUser(openid);

  if (!user || user.role !== 'admin') {
    throw new Error('当前用户没有管理员权限');
  }

  return user;
}

async function getUsersMap(openids) {
  const validOpenids = Array.from(new Set((openids || []).filter(Boolean)));

  if (!validOpenids.length) {
    return {};
  }

  const result = await db.collection('users').where({
    openid: _.in(validOpenids)
  }).get();

  const map = {};
  result.data.forEach(item => {
    map[item.openid || item._openid] = item;
  });
  const missingOpenids = validOpenids.filter(item => !map[item]);

  if (missingOpenids.length) {
    const legacyResult = await db.collection('users').where({
      _openid: _.in(missingOpenids)
    }).get();

    legacyResult.data.forEach(item => {
      map[item.openid || item._openid] = item;
    });
  }
  return map;
}

async function createNotification(userOpenId, title, content, type, orderId) {
  await db.collection('notifications').add({
    data: {
      userOpenId,
      title,
      content,
      type: type || 'system',
      orderId: orderId || '',
      read: false,
      createdAt: Date.now()
    }
  });
}

async function getDashboard() {
  const userCountResult = await db.collection('users').count();
  const orderCountResult = await db.collection('orders').count();
  const abnormalCountResult = await db.collection('abnormal_logs').count();
  const pendingWithdrawalCountResult = await db.collection('withdrawals').where({
    status: 'pending'
  }).count();
  const usersResult = await db.collection('users').orderBy('createdAt', 'desc').limit(30).get();
  const ordersResult = await db.collection('orders').orderBy('createdAt', 'desc').limit(40).get();
  const abnormalResult = await db.collection('abnormal_logs').orderBy('createdAt', 'desc').limit(20).get();
  const withdrawalResult = await db.collection('withdrawals').orderBy('createdAt', 'desc').limit(30).get();

  let financeStats = {
    totalVolume: 0,
    platformIncome: 0,
    totalRunnerIncome: 0
  };

  try {
    const financeResult = await db.collection('system_stats').doc('finance').get();
    financeStats = financeResult.data || financeStats;
  } catch (error) {}

  const openids = [];
  usersResult.data.forEach(item => openids.push(item.openid || item._openid));
  ordersResult.data.forEach(item => {
    openids.push(item.publisherOpenId);
    openids.push(item.runnerOpenId);
  });
  abnormalResult.data.forEach(item => openids.push(item.userOpenId));
  withdrawalResult.data.forEach(item => openids.push(item.userOpenId));

  const userMap = await getUsersMap(openids);

  return {
    summary: {
      userCount: userCountResult.total,
      orderCount: orderCountResult.total,
      abnormalCount: abnormalCountResult.total,
      pendingWithdrawals: pendingWithdrawalCountResult.total,
      totalVolumeText: '￥' + roundMoney(financeStats.totalVolume).toFixed(2),
      platformIncomeText: '￥' + roundMoney(financeStats.platformIncome).toFixed(2),
      totalRunnerIncomeText: '￥' + roundMoney(financeStats.totalRunnerIncome).toFixed(2)
    },
    users: usersResult.data.map(item => {
      const profileState = getProfileState(item);

      return {
        id: item._id,
        nickname: item.nickname || '校园同学',
        avatarText: getAvatarText(item.nickname || '我'),
        phone: item.phone || '',
        phoneText: item.phone || '未完善',
        role: item.role || 'user',
        walletBalanceText: '￥' + roundMoney(item.walletBalance).toFixed(2),
        totalIncomeText: '￥' + roundMoney(item.totalIncome).toFixed(2),
        averageScore: item.averageScore || 0,
        averageScoreText: item.averageScore || 0,
        completedJobs: item.completedJobs || 0,
        completedJobsText: item.completedJobs || 0,
        profileStatusText: profileState.isComplete ? '已完善' : '待完善',
        createdAtText: formatTime(item.createdAt || Date.now())
      };
    }),
    orders: ordersResult.data.map(item => ({
      id: item._id,
      typeText: item.type === 'takeout' ? '外卖' : '快递',
      status: item.status,
      payStatus: item.payStatus,
      rewardText: '￥' + roundMoney(item.rewardAmount).toFixed(2),
      publisherName: userMap[item.publisherOpenId] ? userMap[item.publisherOpenId].nickname : '未知用户',
      runnerName: item.runnerOpenId && userMap[item.runnerOpenId] ? userMap[item.runnerOpenId].nickname : '暂无',
      deliveryAddress: item.deliveryAddress,
      createdAtText: formatTime(item.createdAt)
    })),
    abnormalLogs: abnormalResult.data.map(item => ({
      id: item._id,
      nickname: userMap[item.userOpenId] ? userMap[item.userOpenId].nickname : '未知用户',
      type: item.type,
      reason: item.reason,
      createdAtText: formatTime(item.createdAt)
    })),
    withdrawals: withdrawalResult.data.map(item => {
      const user = userMap[item.userOpenId] || {};
      return {
        id: item._id,
        nickname: user.nickname || '未知用户',
        phone: user.phone || '未提供',
        amountText: '￥' + roundMoney(item.amount).toFixed(2),
        status: item.status,
        createdAtText: formatTime(item.createdAt)
      }
    })
  };
}

async function auditWithdrawal(openid, withdrawalId, decision) {
  await ensureAdmin(openid);

  const withdrawalResult = await db.collection('withdrawals').doc(withdrawalId).get();
  const withdrawal = withdrawalResult.data;

  if (!withdrawal) {
    throw new Error('提现单不存在');
  }

  if (withdrawal.status !== 'pending') {
    throw new Error('该提现单已处理');
  }

  const user = await getCurrentUser(withdrawal.userOpenId);

  if (!user) {
    throw new Error('提现用户不存在');
  }

  if (decision === 'approve') {
    await db.collection('withdrawals').doc(withdrawalId).update({
      data: {
        status: 'paid',
        updatedAt: Date.now(),
        processedAt: Date.now(),
        processedByOpenId: openid,
        remark: '管理员已审核通过，请线下或通过商户工具完成实际打款。'
      }
    });

    await db.collection('users').doc(user._id).update({
      data: {
        totalWithdrawn: _.inc(roundMoney(withdrawal.amount)),
        updatedAt: Date.now()
      }
    });

    await createNotification(withdrawal.userOpenId, '提现已通过', '你的提现申请已审核通过，平台将尽快完成打款。', 'withdrawal', '');
  } else {
    await db.collection('withdrawals').doc(withdrawalId).update({
      data: {
        status: 'rejected',
        updatedAt: Date.now(),
        processedAt: Date.now(),
        processedByOpenId: openid,
        remark: '管理员已驳回，本次金额已退回余额。'
      }
    });

    await db.collection('users').doc(user._id).update({
      data: {
        walletBalance: _.inc(roundMoney(withdrawal.amount)),
        updatedAt: Date.now()
      }
    });

    await createNotification(withdrawal.userOpenId, '提现已驳回', '你的提现申请已被驳回，金额已退回余额。', 'withdrawal', '');
  }

  return {
    withdrawalId,
    status: decision === 'approve' ? 'paid' : 'rejected'
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;

  try {
    switch (event.action) {
      case 'getDashboard':
        await ensureAdmin(openid);
        return success(await getDashboard());
      case 'auditWithdrawal':
        return success(await auditWithdrawal(openid, event.withdrawalId, event.decision));
      default:
        return fail('不支持的操作类型');
    }
  } catch (error) {
    return fail(error.message || '云函数执行失败');
  }
};

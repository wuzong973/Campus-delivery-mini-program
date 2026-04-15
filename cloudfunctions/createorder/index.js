const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 创建订单函数
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  // 从 event 中获取前端传递的订单数据 payload
  const { payload } = event;

  if (!openid) {
    return { success: false, message: '用户未登录' };
  }

  if (!payload) {
    return { success: false, message: '缺少订单信息' };
  }

  try {
    // 1. 基础数据校验 (可根据业务需求扩展)
    if (!payload.reward || payload.reward <= 0) {
      return { success: false, message: '悬赏金额必须大于0' };
    }
    if (!payload.deliveryAddress || !payload.pickupAddress) {
      return { success: false, message: '地址信息不完整' };
    }

    // 2. 构造要存入数据库的订单对象
    const orderData = {
      ...payload,
      publisherOpenId: openid, // 发布者 openid
      runnerOpenId: '', // 接单者 openid，初始为空
      status: 'pending', // 订单状态：pending (待接单)
      payStatus: 'pending', // 支付状态：pending (待支付)
      createdAt: Date.now(), // 创建时间
      updatedAt: Date.now(), // 更新时间
      // 确保一些数值字段是数字类型
      rewardAmount: Number(payload.reward || 0),
      basePrice: Number(payload.basePrice || 0),
    };

    // 移除前端传来的、不需要直接存入的字段
    delete orderData.reward;

    // 3. 将订单数据写入数据库
    const addResult = await db.collection('orders').add({
      data: orderData
    });

    // 4. 返回成功信息和新创建的订单 ID
    return {
      success: true,
      message: '订单创建成功',
      orderId: addResult._id
    };

  } catch (error) {
    console.error('创建订单时发生错误:', error);
    return {
      success: false,
      message: '数据库操作失败，请稍后重试'
    };
  }
};

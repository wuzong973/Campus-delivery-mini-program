const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 支付回调函数
exports.main = async (event) => {
  console.log('微信支付回调 event:', event);

  // 从回调事件中获取关键信息
  const { outTradeNo, resultCode, transactionId } = event;

  // 检查支付是否成功
  if (resultCode !== 'SUCCESS') {
    console.error('支付未成功:', event);
    // 直接返回成功，告知微信服务器无需重试
    return { errcode: 0, errmsg: 'SUCCESS' };
  }

  try {
    // 1. 根据商户订单号 (outTradeNo) 查询订单
    const orderRes = await db.collection('orders').doc(outTradeNo).get();
    const order = orderRes.data;

    if (!order) {
      console.error(`订单不存在: ${outTradeNo}`);
      return { errcode: 0, errmsg: 'SUCCESS' };
    }

    // 2. 检查订单状态，防止重复处理
    if (order.payStatus === 'paid') {
      console.log(`订单 ${outTradeNo} 已处理，无需重复操作`);
      return { errcode: 0, errmsg: 'SUCCESS' };
    }

    // 3. 更新订单状态为“已支付”
    await db.collection('orders').doc(outTradeNo).update({
      data: {
        payStatus: 'paid',
        transactionId: transactionId, // 记录微信支付交易单号
        updatedAt: Date.now()
      }
    });

    console.log(`订单 ${outTradeNo} 状态已更新为 paid`);

    // 4. （可选）记录支付日志
    await db.collection('payment_logs').add({
      data: {
        orderId: outTradeNo,
        transactionId: transactionId,
        status: 'SUCCESS',
        amount: order.rewardAmount,
        userOpenId: order.publisherOpenId,
        createdAt: Date.now(),
        raw: event // 保存原始回调数据
      }
    });

    // 5. （可选）给用户发送支付成功通知
    await db.collection('notifications').add({
      data: {
        userOpenId: order.publisherOpenId,
        title: '订单支付成功',
        content: `您的订单（尾号${outTradeNo.slice(-6)}）已支付成功，正在等待接单。`,
        type: 'order',
        orderId: outTradeNo,
        read: false,
        createdAt: Date.now()
      }
    });

    // 6. 向微信支付服务器返回成功应答
    return { errcode: 0, errmsg: 'SUCCESS' };

  } catch (error) {
    console.error('处理支付回调时发生错误:', error);
    // 即使内部出错，也应返回成功，避免微信服务器不断重试
    // 错误应通过日志系统进行监控和手动处理
    return { errcode: 0, errmsg: 'SUCCESS' };
  }
};

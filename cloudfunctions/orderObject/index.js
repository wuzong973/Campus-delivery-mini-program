const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

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

function getEventByMethod(method, payload) {
  switch (method) {
    case 'publish':
      return { action: 'publish', payload };
    case 'getTaskList':
      return { action: 'getTaskList', currentLocation: payload.currentLocation || null };
    case 'getTaskDetail':
      return { action: 'getTaskDetail', orderId: payload.orderId };
    case 'acceptTask':
      return { action: 'acceptTask', orderId: payload.orderId, currentLocation: payload.currentLocation || null };
    case 'toggleFavorite':
      return { action: 'toggleFavorite', orderId: payload.orderId };
    case 'uploadDeliveryProof':
      return { action: 'uploadDeliveryProof', orderId: payload.orderId, fileID: payload.fileID, note: payload.note || '' };
    case 'completeOrder':
      return { action: 'completeOrder', orderId: payload.orderId };
    case 'cancelOrder':
      return { action: 'cancelOrder', orderId: payload.orderId };
    case 'rateRunner':
      return { action: 'rateRunner', orderId: payload.orderId, payload: payload.payload || {} };
    case 'getMineData':
      return { action: 'getMineData' };
    case 'getOrderList':
      return { action: 'getOrderList', status: payload.status || 'all' };
    default:
      throw new Error('不支持的云对象方法');
  }
}

exports.main = async (event) => {
  try {
    const method = event.method;
    const payload = event.payload || {};
    if (!method) {
      return fail('缺少 method');
    }

    const mappedEvent = getEventByMethod(method, payload);
    const result = await cloud.callFunction({
      name: 'order',
      data: mappedEvent
    });

    const body = result && result.result ? result.result : {};
    if (body.success === false) {
      return fail(body.message || '云对象执行失败');
    }
    return success(body.data);
  } catch (error) {
    return fail(error.message || '云对象执行失败');
  }
};

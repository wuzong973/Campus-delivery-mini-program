/**
 * 微信小程序「一次性订阅消息」前端工具
 * ====================================================================
 * 微信订阅消息规则限制（开发必读）：
 * 1. wx.requestSubscribeMessage 必须由「用户点击事件」直接触发，
 *    不能在 onLoad、onShow、定时器、Promise 链等非用户手势场景自动调用，
 *    否则会报错：can only be invoked by user TAP gesture。
 *    （注意：wx.showModal 的 success 回调中调用也会失败，必须直接在 bindtap 中调用）
 * 2. 单次调用 wx.requestSubscribeMessage 最多支持传入 3 个模板 tmplIds。
 * 3. 用户「同意」授权后，后端可向该用户下发「1 条」对应模板的消息，
 *    即一次授权 = 一条消息额度，下发后即消耗（一次性订阅）。
 * 4. 用户「拒绝」或被「禁止」(总是拒绝) 时，业务流程不应中断，仅影响本次是否推送。
 * ====================================================================
 */

// 订阅模板 ID 配置
// 使用前请在微信公众平台「功能 - 订阅消息」中申请对应模板，并将下方占位 ID 替换为真实模板 ID
const SUBSCRIBE_TEMPLATE_IDS = {
  // 下单成功通知：用户点击「提交订单」时唤起，通知用户订单已创建
  orderCreated: "TEMPLATE_ID_ORDER_CREATED_PLACEHOLDER",
  // 接单成功通知：骑手点击「接单」时唤起，通知用户订单已被接单
  orderAccepted: "TEMPLATE_ID_ORDER_ACCEPTED_PLACEHOLDER",
  // 提现成功通知：用户点击「提现」时唤起，通知用户提现申请已受理/完成
  withdrawSuccess: "TEMPLATE_ID_WITHDRAW_SUCCESS_PLACEHOLDER",
};

/**
 * 判断模板 ID 是否为未替换的占位符（避免用非法 ID 调用微信接口报错）
 * @param {string} id 模板 ID
 * @returns {boolean}
 */
function isPlaceholderId(id) {
  return !id || /^TEMPLATE_ID_.*_PLACEHOLDER$/.test(id);
}

/**
 * 唤起一次性订阅消息授权弹窗
 * 必须在用户点击事件（bindtap）的同步调用链中触发，否则微信会拒绝调用。
 *
 * @param {string|Array<string>} templateKeys 模板键名或键名数组（SUBSCRIBE_TEMPLATE_IDS 的 key）
 *   一次最多 3 个模板（微信限制），超出会被截断
 * @returns {Promise<Object>} resolve 结果对象（永不 reject，避免阻断业务）
 *   - status: 'accept' | 'reject' | 'ban' | 'unsupported' | 'fail'
 *   - accepted: string[] 用户同意的模板 ID 数组
 *   - rejected: string[] 用户拒绝/被禁止的模板 ID 数组
 *   - error: 仅 status='fail' 时存在，调用失败的原始错误
 */
function requestSubscribe(templateKeys) {
  const keys = Array.isArray(templateKeys) ? templateKeys : [templateKeys];

  // 根据传入的 key 解析出真实模板 ID，并过滤掉未配置的占位 ID
  const tmplIds = keys
    .map((k) => SUBSCRIBE_TEMPLATE_IDS[k])
    .filter((id) => !isPlaceholderId(id))
    // 微信限制：单次最多 3 个模板
    .slice(0, 3);

  return new Promise((resolve) => {
    // 未配置真实模板 ID 时直接跳过，不阻断后续业务流程
    if (!tmplIds.length) {
      resolve({ status: "unsupported", accepted: [], rejected: [] });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: tmplIds,
      success(res) {
        // res 形如：{ 'tmplId1': 'accept', 'tmplId2': 'reject', errMsg: 'requestSubscribeMessage:ok' }
        const accepted = [];
        const rejected = [];

        tmplIds.forEach((id) => {
          if (res[id] === "accept") {
            // 用户同意订阅该模板，后端获得一次下发额度
            accepted.push(id);
          } else {
            // res[id] === 'reject'（用户拒绝）或 'ban'（用户已选「总是保持以上选择」被禁止）
            rejected.push(id);
          }
        });

        // 整体状态：有任意同意项记为 accept，否则记为 reject
        const status = accepted.length
          ? "accept"
          : rejected.length
            ? "reject"
            : "fail";

        resolve({ status, accepted, rejected });
      },
      fail(err) {
        // 调用失败（如接口被禁用、网络异常、场景值不支持等），不阻断业务
        resolve({ status: "fail", accepted: [], rejected: [], error: err });
      },
    });
  });
}

module.exports = {
  SUBSCRIBE_TEMPLATE_IDS,
  isPlaceholderId,
  requestSubscribe,
};

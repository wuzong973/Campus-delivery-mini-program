/**
 * 微信小程序「一次性订阅消息」后端推送服务（请求示例）
 * ====================================================================
 * 使用流程：
 * 1. 前端在用户点击事件中调用 wx.requestSubscribeMessage 获得用户授权；
 *    （一次性订阅：用户每「同意」一次，后端可下发 1 条对应模板消息）
 * 2. 业务事件发生时（订单创建/接单/提现完成），后端调用本服务向用户推送消息；
 * 3. 推送需要 access_token（接口调用凭证），需全局缓存并定期刷新。
 *
 * 相关微信接口：
 * - 获取 access_token：GET https://api.weixin.qq.com/cgi-bin/token
 * - 发送订阅消息：POST https://api.weixin.qq.com/cgi-bin/message/subscribe/send
 *
 * 前置配置：
 * - 在微信公众平台「功能 - 订问消息」中申请模板，获取 template_id；
 * - 确认 server/.env 中已配置 WECHAT_APP_ID 与 WECHAT_APP_SECRET。
 * ====================================================================
 */
const axios = require("axios");
const env = require("../config/env");

// 订阅模板 ID 配置（与前端 utils/subscribe.js 中的模板一一对应，替换为真实 ID）
const SUBSCRIBE_TEMPLATE_IDS = {
  // 下单成功通知
  orderCreated: "_00q1V3Vua4pus6QSeKXvd7HXX-ChrSDT4V3XQyASlQ",
  // 接单成功通知
  orderAccepted: "3xL_uXXW2teDmUEvqWVb55jcJRTT_4xkLe5Qgjk3YJQ",
  // 提现成功通知
  withdrawSuccess: "K6mHX7fmfWU9aPS0qzg_nRqBKtKqmxjFdlrnV3miehI",
};

// access_token 内存缓存（进程级）
// access_token 有效期 7200 秒，建议在到期前 5 分钟刷新，避免临界过期
let cachedAccessToken = {
  value: "",
  expiresAt: 0, // 过期时间戳（毫秒）
};

/**
 * 获取微信接口调用凭证 access_token（带缓存）
 * 注意：access_token 每天有调用次数限制，必须做服务端缓存，不能每次推送都重新获取。
 * 多实例部署时应改用 Redis 等共享缓存，并加分布式锁，避免重复刷新。
 *
 * @param {boolean} forceRefresh 是否强制刷新（忽略缓存）
 * @returns {Promise<string>} access_token
 */
async function getAccessToken(forceRefresh = false) {
  const now = Date.now();

  // 缓存未过期则直接复用（提前 5 分钟视为过期，避免临界点失效）
  if (!forceRefresh && cachedAccessToken.value && now < cachedAccessToken.expiresAt) {
    return cachedAccessToken.value;
  }

  if (!env.appId) {
    throw new Error("后端缺少 WECHAT_APP_ID 配置");
  }
  if (!env.appSecret) {
    throw new Error("后端缺少 WECHAT_APP_SECRET 配置，请检查 server/.env");
  }

  let response;
  try {
    response = await axios.get("https://api.weixin.qq.com/cgi-bin/token", {
      params: {
        grant_type: "client_credential",
        appid: env.appId,
        secret: env.appSecret,
      },
      timeout: 10000,
    });
  } catch (error) {
    throw new Error(`获取 access_token 网络失败: ${error.message || "网络错误"}`);
  }

  const data = (response && response.data) || {};
  if (data.errcode) {
    throw new Error(
      `获取 access_token 失败：${data.errmsg}（errcode: ${data.errcode}）`,
    );
  }
  if (!data.access_token) {
    throw new Error("获取 access_token 失败：返回数据缺少 access_token 字段");
  }

  // expires_in 单位秒，缓存时提前 5 分钟过期
  const expiresInMs = Number(data.expires_in || 7200) * 1000;
  cachedAccessToken = {
    value: data.access_token,
    expiresAt: now + expiresInMs - 5 * 60 * 1000,
  };

  return cachedAccessToken.value;
}

/**
 * 发送一次性订阅消息（通用方法）
 * 微信文档：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/subscribe-message/subscribeMessage.send.html
 *
 * @param {Object} params
 * @param {string} params.touser       接收消息的用户 openid
 * @param {string} params.templateId   订阅模板 ID
 * @param {Object} params.data         模板内容，形如 { keyword1: { value: 'xx' }, keyword2: { value: 'xx' } }
 * @param {string} [params.page]       点击模板卡片后跳转的页面（带参数），如 'pages/taskDetail/taskDetail?id=123'
 * @param {string} [params.miniprogramState] 小程序版本：'developer' | 'trial' | 'formal'，默认 'formal'
 * @param {string} [params.lang]       语言，默认 'zh_CN'
 * @returns {Promise<Object>} 微信接口返回结果
 */
async function sendSubscribeMessage(params) {
  const {
    touser,
    templateId,
    data,
    page = "",
    miniprogramState = "formal",
    lang = "zh_CN",
  } = params;

  if (!touser) {
    throw new Error("缺少接收消息的用户 openid");
  }
  if (!templateId) {
    throw new Error("缺少订阅模板 templateId");
  }
  if (!data || typeof data !== "object") {
    throw new Error("缺少模板内容 data");
  }

  // 获取 access_token（带缓存），失败时重试一次
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    throw error;
  }

  // 调用发送订阅消息接口
  let response;
  try {
    response = await axios.post(
      "https://api.weixin.qq.com/cgi-bin/message/subscribe/send",
      {
        touser, // 接收者 openid
        template_id: templateId, // 模板 ID
        page, // 点击模板卡片后的跳转页面
        miniprogram_state: miniprogramState, // 跳转小程序版本
        lang, // 模板内容语言
        data, // 模板关键词数据
      },
      {
        params: { access_token: accessToken },
        timeout: 10000,
      },
    );
  } catch (error) {
    throw new Error(`发送订阅消息网络失败: ${error.message || "网络错误"}`);
  }

  const result = (response && response.data) || {};

  // access_token 过期（errcode 40001 / 42001）时强制刷新后重试一次
  if (result.errcode === 40001 || result.errcode === 42001) {
    const freshToken = await getAccessToken(true);
    const retryResponse = await axios.post(
      "https://api.weixin.qq.com/cgi-bin/message/subscribe/send",
      { touser, template_id: templateId, page, miniprogram_state: miniprogramState, lang, data },
      { params: { access_token: freshToken }, timeout: 10000 },
    );
    return (retryResponse && retryResponse.data) || {};
  }

  // 其它错误码抛出（如 43101 用户未订阅、40037 模板 ID 不合法等）
  if (result.errcode) {
    throw new Error(
      `发送订阅消息失败：${result.errmsg}（errcode: ${result.errcode}）`,
    );
  }

  return result;
}

/* ====================================================================
 * 业务封装示例：三种场景的订阅消息推送
 * 下方 keyword1/keyword2/... 必须与微信公众平台模板中申请的关键词顺序一一对应，
 * 实际字段名以模板配置为准（有的模板用 thing1、amount2、time3 等命名）。
 * ==================================================================== */

/**
 * 发送「下单成功通知」
 * 触发时机：用户提交订单并支付成功后，由后端订单服务调用
 *
 * @param {string} openid 下单用户 openid
 * @param {Object} order 订单信息
 * @param {string} order.orderNo 订单编号
 * @param {string} order.typeText 订单类型文案（如"外卖"）
 * @param {string} order.rewardText 赏金文案（如"¥3.00"）
 * @param {string} order.createdAtText 创建时间文案
 */
async function sendOrderCreatedNotify(openid, order) {
  return sendSubscribeMessage({
    touser: openid,
    templateId: SUBSCRIBE_TEMPLATE_IDS.orderCreated,
    page: `pages/taskDetail/taskDetail?id=${order.id || ""}`,
    miniprogramState: "formal",
    data: {
      keyword1: { value: order.orderNo || "-" }, // 订单编号
      keyword2: { value: order.typeText || "-" }, // 订单类型
      keyword3: { value: order.rewardText || "-" }, // 订单金额
      keyword4: { value: order.createdAtText || "-" }, // 下单时间
    },
  });
}

/**
 * 发送「接单成功通知」
 * 触发时机：骑手接单成功后，由后端订单服务向「下单用户」推送
 *
 * @param {string} openid 下单用户 openid（接收方）
 * @param {Object} order 订单信息
 * @param {string} order.orderNo 订单编号
 * @param {string} order.runnerName 骑手昵称
 * @param {string} order.acceptedAtText 接单时间
 */
async function sendOrderAcceptedNotify(openid, order) {
  return sendSubscribeMessage({
    touser: openid,
    templateId: SUBSCRIBE_TEMPLATE_IDS.orderAccepted,
    page: `pages/taskDetail/taskDetail?id=${order.id || ""}`,
    miniprogramState: "formal",
    data: {
      keyword1: { value: order.orderNo || "-" }, // 订单编号
      keyword2: { value: order.runnerName || "-" }, // 接单骑手
      keyword3: { value: order.acceptedAtText || "-" }, // 接单时间
    },
  });
}

/**
 * 发送「提现成功通知」
 * 触发时机：提现申请审核通过/打款成功后，由后端钱包服务向用户推送
 *
 * @param {string} openid 提现用户 openid
 * @param {Object} withdraw 提现信息
 * @param {string} withdraw.amountText 提现金额文案（如"¥50.00"）
 * @param {string} withdraw.statusText 状态文案（如"已到账"）
 * @param {string} withdraw.finishedAtText 完成时间
 */
async function sendWithdrawSuccessNotify(openid, withdraw) {
  return sendSubscribeMessage({
    touser: openid,
    templateId: SUBSCRIBE_TEMPLATE_IDS.withdrawSuccess,
    page: "pages/wallet/wallet",
    miniprogramState: "formal",
    data: {
      keyword1: { value: withdraw.amountText || "-" }, // 提现金额
      keyword2: { value: withdraw.statusText || "-" }, // 提现状态
      keyword3: { value: withdraw.finishedAtText || "-" }, // 到账时间
    },
  });
}

module.exports = {
  SUBSCRIBE_TEMPLATE_IDS,
  getAccessToken,
  sendSubscribeMessage,
  sendOrderCreatedNotify,
  sendOrderAcceptedNotify,
  sendWithdrawSuccessNotify,
};

const axios = require("axios");
const env = require("./env");

function createWechatError(message, statusCode = 500, code = "WECHAT_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function codeToSession(code) {
  if (!code) {
    throw createWechatError("缺少微信登录 code", 400, "MISSING_CODE");
  }

  if (!env.appId) {
    throw createWechatError("后端缺少微信 AppID 配置", 500, "MISSING_APP_ID");
  }

  if (!env.appSecret) {
    throw createWechatError(
      "后端缺少微信 AppSecret 配置，请检查 server/.env",
      500,
      "MISSING_APP_SECRET",
    );
  }

  if (String(env.appSecret).trim().length < 32) {
    throw createWechatError(
      "后端微信 AppSecret 格式不正确，请在微信公众平台重新复制后更新 server/.env。",
      500,
      "INVALID_APP_SECRET_FORMAT",
    );
  }

  let response;
  try {
    response = await axios.get("https://api.weixin.qq.com/sns/jscode2session", {
      params: {
        appid: String(env.appId).trim(),
        secret: String(env.appSecret).trim(),
        js_code: String(code).trim(),
        grant_type: "authorization_code",
      },
      timeout: 10000,
    });
  } catch (error) {
    throw createWechatError(
      `调用微信登录接口失败: ${error.message || "网络错误"}`,
      502,
      "WECHAT_REQUEST_FAIL",
    );
  }

  const data = response && response.data ? response.data : {};
  if (data.errcode) {
    const errcode = Number(data.errcode);
    const errmsg = String(data.errmsg || "微信登录失败");

    if (errcode === 40013) {
      throw createWechatError(
        `微信登录失败：无效的 AppID，请检查小程序 AppID 配置。${errmsg}`,
        502,
        "INVALID_APP_ID",
      );
    }

    if (errcode === 40125) {
      throw createWechatError(
        `微信登录失败：无效的 AppSecret，请在微信公众平台重新核对后端配置。${errmsg}`,
        502,
        "INVALID_APP_SECRET",
      );
    }

    if (errcode === 40029) {
      throw createWechatError(
        `微信登录失败：登录 code 已失效，请重新尝试登录。${errmsg}`,
        401,
        "INVALID_LOGIN_CODE",
      );
    }

    throw createWechatError(
      `微信登录失败：${errmsg}（errcode: ${errcode}）`,
      502,
      "WECHAT_SESSION_FAIL",
    );
  }

  if (!data.openid) {
    throw createWechatError(
      "微信登录失败：未获取到 openid",
      502,
      "MISSING_OPENID",
    );
  }

  return data;
}

module.exports = {
  codeToSession,
};

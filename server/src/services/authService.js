const { adminOpenids } = require("../config/env");
const { codeToSession } = require("../config/wechat");
const { signToken } = require("../utils/jwt");
const { isValidOpenid } = require("../utils/validate");
const { now, normalizeUser, getCurrentUser, User } = require("./shared");

function shouldGrantAdmin(openid) {
  return Array.isArray(adminOpenids) && adminOpenids.includes(openid);
}

async function ensureLoginUser(openid, payload) {
  let user = await getCurrentUser(openid);
  const userInfo = payload && payload.userInfo ? payload.userInfo : null;

  if (!user) {
    const created = await User.create({
      openid,
      nickname: userInfo ? userInfo.nickName : "校园同学",
      avatarUrl: userInfo ? userInfo.avatarUrl : "",
      phone: "",
      commonAddress: "",
      avatarTheme: "ocean",
      slogan: userInfo
        ? "已同步微信昵称和头像"
        : "微信登录已接入，欢迎完善个人资料",
      role: shouldGrantAdmin(openid) ? "admin" : "user",
      completedJobs: 0,
      averageScore: 0,
      walletBalance: 0,
      totalIncome: 0,
      totalWithdrawn: 0,
      totalSpending: 0,
      lastLoginCode: payload && payload.code ? payload.code : "",
      loginCount: 1,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: now(),
    });
    user = created.toObject();
  } else {
    const patch = {
      lastLoginCode: payload && payload.code ? payload.code : "",
      updatedAt: now(),
      lastLoginAt: now(),
      loginCount: Number(user.loginCount || 0) + 1,
    };

    if (!user.avatarUrl && userInfo && userInfo.avatarUrl) {
      patch.avatarUrl = userInfo.avatarUrl;
    }
    if (
      (!user.nickname || user.nickname === "校园同学") &&
      userInfo &&
      userInfo.nickName
    ) {
      patch.nickname = userInfo.nickName;
    }

    await User.updateOne({ _id: user._id }, { $set: patch });
    user = {
      ...user,
      ...patch,
    };
  }

  return user;
}

/**
 * 微信登录：只接受 wx.login 返回的 code，由服务端向微信换取 openid。
 *
 * 安全约束（重要）：绝不接受请求体里直接传入的 openid。
 * 历史实现允许 `{ openid: "xxx" }` 直接换取 token，导致任何人只要拿到
 * 他人的 openid（接单大厅接口曾泄露）就能登录成对方，构成完整的账号接管链。
 * 会话恢复请改用 GET /auth/session（基于已签发的 token 校验），不要回退到裸 openid。
 */
async function loginWithWechat(payload) {
  const code = String((payload && payload.code) || "").trim();

  if (!code) {
    const error = new Error("缺少微信登录 code");
    error.statusCode = 400;
    error.code = "MISSING_LOGIN_CREDENTIALS";
    throw error;
  }

  const session = await codeToSession(code);
  const openid = session && session.openid ? String(session.openid).trim() : "";

  if (!openid) {
    const error = new Error("登录失败，未获取到 openid");
    error.statusCode = 502;
    error.code = "MISSING_OPENID";
    throw error;
  }

  if (!isValidOpenid(openid)) {
    const error = new Error("登录失败，openid 格式异常");
    error.statusCode = 502;
    error.code = "INVALID_OPENID";
    throw error;
  }

  const user = await ensureLoginUser(openid, payload);
  const token = signToken({
    _id: user._id,
    openid,
    role: user.role || "user",
  });

  if (String(token).split(".").length !== 3) {
    const error = new Error("登录失败，JWT 生成异常");
    error.statusCode = 500;
    error.code = "INVALID_JWT";
    throw error;
  }

  return {
    token,
    tokenType: "Bearer",
    openid,
    user: normalizeUser(user),
  };
}

/**
 * 会话恢复：校验已签发的 token 是否仍然有效，并回传当前用户资料。
 * 供小程序冷启动时使用，替代过去「拿缓存 openid 重新换 token」的不安全做法。
 */
async function getSession(openid) {
  const user = await getCurrentUser(openid);
  if (!user) {
    const error = new Error("用户不存在，请重新登录");
    error.statusCode = 401;
    error.code = "AUTH_EXPIRED";
    throw error;
  }

  return {
    openid,
    user: normalizeUser(user),
  };
}

module.exports = {
  loginWithWechat,
  getSession,
  ensureLoginUser,
  isValidOpenid,
};

const { adminOpenids } = require("../config/env");
const { codeToSession } = require("../config/wechat");
const { signToken } = require("../utils/jwt");
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

async function loginWithWechat(payload) {
  const directOpenid = String((payload && payload.openid) || "").trim();

  if (!directOpenid && (!payload || !payload.code)) {
    const error = new Error("缺少 openid 或微信登录 code");
    error.statusCode = 400;
    error.code = "MISSING_LOGIN_CREDENTIALS";
    throw error;
  }

  let openid = directOpenid;
  if (!openid) {
    const session = await codeToSession(payload.code);
    openid = session && session.openid ? session.openid : "";
  }

  if (!openid) {
    const error = new Error("登录失败，未获取到 openid");
    error.statusCode = 502;
    error.code = "MISSING_OPENID";
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

module.exports = {
  loginWithWechat,
  ensureLoginUser,
};

const { verifyToken } = require("../utils/jwt");
const { isValidOpenid } = require("../utils/validate");
const { adminOpenids } = require("../config/env");
const { User } = require("../models");

/**
 * 判断该 openid 是否应被授予管理员。
 * 只采信服务端配置白名单，绝不采信 token 里自带的 role 声明 ——
 * 否则攻击者只要拿到签发密钥就能自签一个 role:"admin" 的 token 直接提权。
 */
function shouldGrantAdmin(openid) {
  return Array.isArray(adminOpenids) && adminOpenids.includes(openid);
}

async function ensureUserFromToken(decoded) {
  if (!decoded || !decoded.openid) {
    return null;
  }

  const existing = await User.findOne({ openid: decoded.openid }).lean();
  if (existing) {
    return existing;
  }

  const created = await User.create({
    openid: decoded.openid,
    nickname: "校园同学",
    avatarUrl: "",
    phone: "",
    commonAddress: "",
    avatarTheme: "ocean",
    slogan: "微信登录用户",
    role: shouldGrantAdmin(decoded.openid) ? "admin" : "user",
    completedJobs: 0,
    averageScore: 0,
    walletBalance: 0,
    totalIncome: 0,
    totalWithdrawn: 0,
    totalSpending: 0,
    lastLoginCode: "",
    loginCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastLoginAt: Date.now(),
  });

  return created.toObject();
}

async function authMiddleware(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const rawToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : authorization;
    const token = rawToken || req.headers["x-access-token"] || req.query.token || "";

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "未登录或登录已失效",
      });
    }

    const decoded = verifyToken(String(token).trim());

    // 校验 token 里的 openid 格式，避免非法字符（如 "." / "$"）流入下游的
    // MongoDB 查询与更新路径
    if (!decoded || !isValidOpenid(decoded.openid)) {
      return res.status(401).json({
        success: false,
        message: "登录凭证无效，请重新登录",
      });
    }

    const user = await ensureUserFromToken(decoded);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "用户不存在，请重新登录",
      });
    }

    req.auth = decoded;
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "登录状态已过期，请重新登录",
    });
  }
}

module.exports = authMiddleware;

const { verifyToken } = require("../utils/jwt");
const { User } = require("../models");

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
    role: decoded.role || "user",
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

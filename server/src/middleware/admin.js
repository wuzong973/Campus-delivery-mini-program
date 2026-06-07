function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "当前用户没有管理员权限",
    });
  }

  next();
}

module.exports = adminMiddleware;

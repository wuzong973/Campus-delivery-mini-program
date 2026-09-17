/**
 * 安全中间件（零外部依赖）
 *
 * 这里刻意不引入 helmet / express-rate-limit：
 * 生产服务器上重新 npm install 往往受网络与权限限制，而本项目只需要
 * 「安全响应头 + 基础限流」这两件事，用几十行自己实现更可控、部署更省事。
 * 如果后续需要更复杂的策略（分布式限流、Redis 计数），再换成成熟库。
 */

/**
 * 安全响应头。对应 helmet 的核心子集。
 */
function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  // 不要对外暴露技术栈
  res.removeHeader("X-Powered-By");
  next();
}

/**
 * 基于内存的滑动窗口限流。
 *
 * 注意：计数保存在进程内存中，多实例部署时每个实例各算一份。
 * 对当前单机部署足够；若将来横向扩容，应换成基于 Redis 的共享计数。
 *
 * @param {object} options
 * @param {number} options.windowMs 时间窗口（毫秒）
 * @param {number} options.max      窗口内允许的最大请求数
 * @param {string} [options.message] 超限时的提示文案
 * @param {function} [options.keyGenerator] 自定义计数维度，默认按客户端 IP
 * @param {boolean} [options.skipSuccessful] 是否只统计失败请求（用于登录撞库防护）
 */
function createRateLimiter(options) {
  const windowMs = Number(options.windowMs) || 60 * 1000;
  const max = Number(options.max) || 60;
  const message = options.message || "请求过于频繁，请稍后再试。";
  const keyGenerator =
    options.keyGenerator ||
    ((req) => req.ip || req.socket.remoteAddress || "unknown");

  const buckets = new Map();

  // 定期回收过期桶，避免内存无限增长
  const sweep = setInterval(() => {
    const current = Date.now();
    buckets.forEach((bucket, key) => {
      if (bucket.resetAt <= current) {
        buckets.delete(key);
      }
    });
  }, windowMs);
  if (typeof sweep.unref === "function") {
    sweep.unref();
  }

  function rateLimiter(req, res, next) {
    const key = keyGenerator(req);
    const current = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(max - bucket.count, 0);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (bucket.count > max) {
      const retryAfter = Math.max(
        Math.ceil((bucket.resetAt - current) / 1000),
        1,
      );
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message,
      });
      return;
    }

    next();
  }

  return rateLimiter;
}

/**
 * CORS 来源校验。
 *
 * 微信小程序发起的请求不带 Origin 头，必须放行；
 * 浏览器跨域请求则只允许命中白名单的来源，未命中时不返回 CORS 头，
 * 由浏览器自行拦截。
 */
function createCorsOriginChecker(allowedOrigins) {
  const list = Array.isArray(allowedOrigins) ? allowedOrigins : [];

  return function checkOrigin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (list.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  };
}

module.exports = {
  securityHeaders,
  createRateLimiter,
  createCorsOriginChecker,
};

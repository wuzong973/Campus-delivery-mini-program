function errorMiddleware(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || 500;
  const payload =
    error.payload && typeof error.payload === "object" ? error.payload : null;
  const code = (payload && payload.code) || error.code || "";
  const detail =
    payload && (payload.detail || payload.message)
      ? payload.detail || payload.message
      : "";

  console.error("[server-error]", {
    message: error.message,
    code,
    statusCode,
    payload,
    stack: error.stack,
  });

  const message =
    detail && detail !== error.message
      ? `${error.message} (${detail})`
      : error.message || "服务器繁忙，请稍后重试。";

  return res.status(statusCode).json({
    success: false,
    code,
    message,
    ...(process.env.NODE_ENV === "development"
      ? { detail: payload, stack: error.stack }
      : {}),
  });
}

module.exports = errorMiddleware;

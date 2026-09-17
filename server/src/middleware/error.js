function errorMiddleware(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = Number(error.statusCode) || 500;
  const payload =
    error.payload && typeof error.payload === "object" ? error.payload : null;
  const code = (payload && payload.code) || error.code || "";
  const detail =
    payload && (payload.detail || payload.message)
      ? payload.detail || payload.message
      : "";

  const requestLine = `${req.method} ${req.originalUrl || req.url}`;

  if (statusCode >= 500) {
    // 服务端故障：完整记录，含堆栈与上游响应体，便于定位
    console.error("[server-error]", {
      request: requestLine,
      message: error.message,
      code,
      statusCode,
      payload,
      stack: error.stack,
    });
  } else {
    // 业务/客户端错误（参数不合法、余额不足、无权访问等）是**预期内**的结果，
    // 只记一行摘要，不打印堆栈。
    //
    // 旧实现不分级别地把所有错误都按 [server-error] 打全量堆栈，而服务层的
    // 业务错误当时又一律是 500 —— 结果线上日志被「可提现余额不足」这类
    // 正常提示刷满，真正的故障反而淹没在里面。
    console.warn(
      `[client-error] ${statusCode} ${requestLine} - ${error.message}${
        code ? ` (${code})` : ""
      }`,
    );
  }

  const message =
    detail && detail !== error.message
      ? `${error.message} (${detail})`
      : error.message || "服务器繁忙，请稍后重试。";

  // 堆栈只写日志，绝不回传给客户端。
  // 旧实现用 NODE_ENV === "development" 判断，生产一旦误配该变量就会把
  // 服务器绝对路径和代码结构泄露出去；这里改成必须显式开启调试开关。
  const exposeDebugInfo = process.env.DEBUG_ERRORS === "1";

  return res.status(statusCode).json({
    success: false,
    code,
    message,
    ...(exposeDebugInfo ? { detail: payload, stack: error.stack } : {}),
  });
}

module.exports = errorMiddleware;

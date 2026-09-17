const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const env = require("./config/env");
const apiRoutes = require("./routes/api");
const errorMiddleware = require("./middleware/error");
const {
  securityHeaders,
  createRateLimiter,
  createCorsOriginChecker,
} = require("./middleware/security");
const { handlePayCallback } = require("./services/paymentService");

const app = express();

// 部署在 nginx 之后，需要信任一层代理才能拿到真实客户端 IP，
// 否则限流会把所有请求都算到 nginx 的地址上。
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(securityHeaders);
app.use(
  cors({
    origin: createCorsOriginChecker(env.corsOrigins),
    credentials: false,
  }),
);

// 全站兜底限流：防止脚本刷接口。
// 阈值刻意放得比较宽 —— 校园网常整栋楼共用一个出口 IP，
// 按 IP 限流过严会误伤同宿舍楼的其他同学。真正的防滥用靠各路由的用户级限流。
app.use(
  "/api",
  createRateLimiter({
    windowMs: 60 * 1000,
    max: 1200,
    message: "请求过于频繁，请稍后再试。",
  }),
);

app.use("/uploads", express.static(path.resolve(env.uploadRoot)));
app.use(
  express.json({
    limit: "2mb",
    verify(req, res, buffer) {
      req.rawBody = buffer.toString("utf8");
    },
  }),
);
app.use(
  express.urlencoded({
    extended: true,
  }),
);

app.get("/healthz", (req, res) => {
  res.json({
    success: true,
    data: {
      ok: true,
      time: Date.now(),
    },
  });
});

app.post("/pay_notify.php", async (req, res, next) => {
  try {
    await handlePayCallback(
      req.headers,
      req.rawBody || JSON.stringify(req.body || {}),
    );
    res.json({
      code: "SUCCESS",
      message: "成功",
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", apiRoutes);
app.use(errorMiddleware);

// ── WebSocket 实时消息通道 ────────────────────────────────────────────
// 注意：这一段是线上特有的实现，仓库历史里没有，务必保留。
// src/server.js 依赖 module.exports 导出的是 http.Server（而非 express app），
// 因此 `server` 这个变量名与导出方式都不能改。
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (message) => {
    console.log(`Received message => ${message}`);
    // 广播消息给所有连接的客户端
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

module.exports = server;

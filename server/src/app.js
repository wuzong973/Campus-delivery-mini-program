const express = require("express");
const cors = require("cors");
const path = require("path");

const env = require("./config/env");
const apiRoutes = require("./routes/api");
const errorMiddleware = require("./middleware/error");
const { handlePayCallback } = require("./services/paymentService");

const app = express();

app.use(cors());
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
    await handlePayCallback(req.headers, req.rawBody || JSON.stringify(req.body || {}));
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

module.exports = app;

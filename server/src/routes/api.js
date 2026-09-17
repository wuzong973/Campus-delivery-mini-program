const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const authMiddleware = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");
const { createRateLimiter } = require("../middleware/security");
const { loginWithWechat, getSession } = require("../services/authService");
const { getMe, updateMe } = require("../services/userService");
const {
  getHomeData,
  createOrder,
  toggleFavorite,
  getTaskList,
  getTaskDetail,
  acceptTask,
  uploadDeliveryProof,
  completeOrder,
  cancelOrder,
  rateRunner,
  getMineData,
  getOrderList,
} = require("../services/orderService");
const { Favorite } = require("../models");
const {
  createEscrowPayment,
  getPaymentStatus,
  handlePayCallback,
} = require("../services/paymentService");
const {
  getWalletData,
  createWithdrawal,
} = require("../services/walletService");
const {
  getDashboard,
  auditWithdrawal,
  reconcileOrderByNo,
} = require("../services/adminService");
const {
  ensureChatSession,
  getChatSessions,
  getChatMessages,
  sendChatMessage,
  businessError,
} = require("../services/shared");

const router = express.Router();

/**
 * 已登录路由的限流维度：优先按用户（openid），退化到 IP。
 *
 * 为什么不直接按 IP：校园网常整栋楼共用一个出口 IP，
 * 按 IP 限流会让同宿舍楼的其他同学一起被拦，误伤面太大。
 * 登录接口没有 openid，仍按 IP 限流 —— 那正是防撞库需要的维度。
 */
function byUserOrIp(req) {
  return (req.user && req.user.openid) || req.ip || "unknown";
}

// 敏感接口的独立限流策略（与全站兜底限流叠加生效）
const loginRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 60,
  message: "登录尝试过于频繁，请稍后再试。",
});

const createOrderRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "发布过于频繁，请稍后再试。",
  keyGenerator: byUserOrIp,
});

const withdrawalRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "提现申请过于频繁，请稍后再试。",
  keyGenerator: byUserOrIp,
});

const chatSendRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "发送过于频繁，请稍后再试。",
  keyGenerator: byUserOrIp,
});

function success(res, data) {
  return res.json({
    success: true,
    data,
  });
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function extractToken(req) {
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const xAccessToken = String(req.headers["x-access-token"] || "").trim();
  const queryToken = String((req.query && req.query.token) || "").trim();
  return queryToken || bearer || xAccessToken;
}

// 允许的图片类型 → 服务端强制使用的扩展名。
// 扩展名一律由这张白名单映射得出，绝不使用客户端提供的 originalname，
// 否则可以上传 x.php 这类可执行文件落到静态目录下。
const MIME_EXT_MAP = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// 文件头魔数，用于确认内容真的是图片（mimetype 由客户端控制，不可信）
const IMAGE_SIGNATURES = [
  { ext: ".jpg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { ext: ".png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: ".gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ".webp", offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
];

function safeImageExt(mimetype) {
  return MIME_EXT_MAP[String(mimetype || "").toLowerCase()] || "";
}

function matchesSignature(buffer, signature) {
  if (!buffer || buffer.length < signature.offset + signature.bytes.length) {
    return false;
  }
  return signature.bytes.every(
    (byte, index) => buffer[signature.offset + index] === byte,
  );
}

function detectImageSignature(buffer) {
  const matched = IMAGE_SIGNATURES.find((item) =>
    matchesSignature(buffer, item),
  );
  if (!matched) {
    return "";
  }

  // webp 需要额外确认第 8-11 字节是 "WEBP"
  if (matched.ext === ".webp") {
    const isWebp =
      buffer.length >= 12 &&
      buffer.toString("ascii", 8, 12) === "WEBP";
    return isWebp ? matched.ext : "";
  }

  return matched.ext;
}

function createDiskStorage(folderName) {
  const targetDir = path.join(env.uploadRoot, folderName);
  ensureDir(targetDir);
  return multer.diskStorage({
    destination(req, file, cb) {
      cb(null, targetDir);
    },
    filename(req, file, cb) {
      const ext = safeImageExt(file.mimetype) || ".jpg";
      // 用密码学随机数而不是 Math.random()：上传目录是公开静态可访问的，
      // 文件名是唯一的访问凭据，必须做到不可枚举、不可猜测。
      const random = crypto.randomBytes(12).toString("hex");
      cb(null, `${Date.now()}-${random}${ext}`);
    },
  });
}

const imageFileFilter = (req, file, cb) => {
  if (!safeImageExt(file.mimetype)) {
    cb(new Error("仅支持 jpg / png / webp / gif 格式的图片"));
    return;
  }
  cb(null, true);
};

/**
 * 落盘后校验文件头，确认内容确实是图片。
 * mimetype 与文件名都由客户端控制，只有文件内容无法伪造到能通过魔数校验的程度。
 * 校验失败立即删除文件，避免脏文件残留在可公开访问的静态目录里。
 */
async function verifyUploadedImage(req, res, next) {
  if (!req.file || !req.file.path) {
    next();
    return;
  }

  try {
    const handle = await fs.promises.open(req.file.path, "r");
    let detected = "";
    try {
      const buffer = Buffer.alloc(12);
      const { bytesRead } = await handle.read(buffer, 0, 12, 0);
      detected = detectImageSignature(buffer.slice(0, bytesRead));
    } finally {
      await handle.close();
    }

    if (!detected) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      const error = new Error("文件内容不是有效图片，已拒绝上传");
      error.statusCode = 400;
      error.code = "INVALID_IMAGE_CONTENT";
      next(error);
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

const avatarUpload = multer({
  storage: createDiskStorage("avatars"),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const attachmentUpload = multer({
  storage: createDiskStorage("order-attachments"),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const proofUpload = multer({
  storage: createDiskStorage("delivery-proof"),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const chatImageUpload = multer({
  storage: createDiskStorage("chat-images"),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

router.post("/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    const result = await loginWithWechat(req.body || {});
    const token = String(result && result.token ? result.token : "").trim();

    if (!token || token.split(".").length !== 3) {
      throw new Error("登录失败，JWT 生成异常");
    }

    success(res, {
      token,
      tokenType: "Bearer",
      openid: result.openid,
      user: result.user,
    });
  } catch (error) {
    next(error);
  }
});

// 诊断接口仅用于本地/测试环境排障。它会回显 openid 片段、环境变量开关等
// 内部信息，生产环境必须关闭，否则等于给攻击者提供探测便利。
router.get("/auth/diagnose", async (req, res, next) => {
  if (env.nodeEnv === "production") {
    return res.status(404).json({
      success: false,
      message: "接口不存在",
    });
  }

  try {
    const token = extractToken(req);
    const authHeader = String(req.headers.authorization || "");
    const xAccessToken = String(req.headers["x-access-token"] || "");
    const payload = req.body || {};
    const user = req.user || null;

    let decoded = null;
    let decodeError = "";
    if (token) {
      try {
        decoded = jwt.verify(token, env.jwtSecret);
      } catch (error) {
        decodeError = error.message || "JWT verify failed";
      }
    }

    success(res, {
      phase: req.user ? "authed" : "pre-auth",
      receivedOpenid: String(payload.openid || "").trim(),
      receivedCode: String(payload.code || "").trim(),
      hasUserInfo: !!payload.userInfo,
      tokenPresent: !!token,
      tokenPreview: token.slice(0, 18),
      hasAuthHeader: !!(authHeader || xAccessToken),
      authOpenid: req.auth && req.auth.openid ? req.auth.openid : "",
      tokenDecodedOpenid: decoded && decoded.openid ? decoded.openid : "",
      tokenDecodedRole: decoded && decoded.role ? decoded.role : "",
      tokenDecodeError: decodeError,
      userOpenid: user && user.openid ? user.openid : "",
      userId: user && user._id ? user._id : "",
      role: user && user.role ? user.role : "",
      env: {
        nodeEnv: env.nodeEnv,
        hasMongoUri: !!env.mongoUri,
        hasJwtSecret: !!env.jwtSecret,
        publicBaseUrl: env.publicBaseUrl,
        appId: env.appId,
        hasAppSecret: !!env.appSecret,
      },
      cacheHint: {
        shouldClearCache: false,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.use(authMiddleware);

router.post(
  "/files/avatar",
  avatarUpload.single("file"),
  verifyUploadedImage,
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw businessError("未收到上传文件");
      }
      success(res, {
        url: `${env.publicBaseUrl}/uploads/avatars/${req.file.filename}`,
        path: `/uploads/avatars/${req.file.filename}`,
        filename: req.file.filename,
        size: req.file.size,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/users/me", async (req, res, next) => {
  try {
    success(res, await getMe(req.user.openid));
  } catch (error) {
    next(error);
  }
});

// 会话恢复：小程序冷启动时用已保存的 token 校验登录态，避免重新走一次
// wx.login。这是替代「拿缓存 openid 换 token」的安全做法。
router.get("/auth/session", async (req, res, next) => {
  try {
    success(res, await getSession(req.user.openid));
  } catch (error) {
    next(error);
  }
});

router.patch("/users/me", async (req, res, next) => {
  try {
    success(res, await updateMe(req.user.openid, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/home", async (req, res, next) => {
  try {
    success(res, await getHomeData(req.user.openid));
  } catch (error) {
    next(error);
  }
});

router.post("/orders", createOrderRateLimiter, async (req, res, next) => {
  try {
    success(res, await createOrder(req.user.openid, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/tasks", async (req, res, next) => {
  try {
    const currentLocation =
      req.query.latitude && req.query.longitude
        ? {
            latitude: Number(req.query.latitude),
            longitude: Number(req.query.longitude),
          }
        : null;
    success(res, await getTaskList(req.user.openid, currentLocation));
  } catch (error) {
    next(error);
  }
});

router.get("/orders/:id", async (req, res, next) => {
  try {
    success(res, await getTaskDetail(req.user.openid, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/accept", async (req, res, next) => {
  try {
    success(
      res,
      await acceptTask(
        req.user.openid,
        req.params.id,
        (req.body || {}).currentLocation || null,
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/favorite", async (req, res, next) => {
  try {
    success(res, await toggleFavorite(req.user.openid, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.delete("/orders/:id/favorite", async (req, res, next) => {
  try {
    await Favorite.deleteOne({
      userOpenId: req.user.openid,
      orderId: req.params.id,
    });
    success(res, { isCollected: false });
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/cancel", async (req, res, next) => {
  try {
    success(res, await cancelOrder(req.user.openid, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/complete", async (req, res, next) => {
  try {
    success(res, await completeOrder(req.user.openid, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/rate", async (req, res, next) => {
  try {
    success(
      res,
      await rateRunner(req.user.openid, req.params.id, req.body || {}),
    );
  } catch (error) {
    next(error);
  }
});

router.post(
  "/files/order-attachments",
  attachmentUpload.single("file"),
  verifyUploadedImage,
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw businessError("未收到上传文件");
      }
      success(res, {
        url: `${env.publicBaseUrl}/uploads/order-attachments/${req.file.filename}`,
        path: `/uploads/order-attachments/${req.file.filename}`,
        filename: req.file.filename,
        size: req.file.size,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/files/chat-image",
  chatImageUpload.single("file"),
  verifyUploadedImage,
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw businessError("未收到上传文件");
      }
      success(res, {
        url: `${env.publicBaseUrl}/uploads/chat-images/${req.file.filename}`,
        path: `/uploads/chat-images/${req.file.filename}`,
        filename: req.file.filename,
        size: req.file.size,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/files/delivery-proof",
  proofUpload.single("file"),
  verifyUploadedImage,
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw businessError("未收到上传文件");
      }
      const task = await uploadDeliveryProof(
        req.user.openid,
        req.body.orderId,
        {
          fileID: `/uploads/delivery-proof/${req.file.filename}`,
          note: req.body.note || "",
        },
      );
      success(res, task);
    } catch (error) {
      next(error);
    }
  },
);

router.post("/orders/:id/pay", async (req, res, next) => {
  try {
    success(res, await createEscrowPayment(req.user.openid, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get("/orders/:id/payment-status", async (req, res, next) => {
  try {
    success(res, await getPaymentStatus(req.user.openid, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get("/wallet", async (req, res, next) => {
  try {
    success(res, await getWalletData(req.user.openid));
  } catch (error) {
    next(error);
  }
});

router.post("/wallet/withdrawals", withdrawalRateLimiter, async (req, res, next) => {
  try {
    success(
      res,
      await createWithdrawal(req.user.openid, (req.body || {}).amount),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/mine", async (req, res, next) => {
  try {
    success(res, await getMineData(req.user.openid));
  } catch (error) {
    next(error);
  }
});

router.get("/orders", async (req, res, next) => {
  try {
    success(
      res,
      await getOrderList(req.user.openid, {
        status: req.query.status || "all",
        role: req.query.role || "",
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/admin/dashboard", adminMiddleware, async (req, res, next) => {
  try {
    success(res, await getDashboard(req.user.openid));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/admin/withdrawals/:id/audit",
  adminMiddleware,
  async (req, res, next) => {
    try {
      success(
        res,
        await auditWithdrawal(
          req.user.openid,
          req.params.id,
          (req.body || {}).decision,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/admin/orders/reconcile",
  adminMiddleware,
  async (req, res, next) => {
    try {
      success(
        res,
        await reconcileOrderByNo(req.user.openid, (req.body || {}).orderNo),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post("/chat/sessions/open", async (req, res, next) => {
  try {
    success(res, await ensureChatSession(req.user.openid, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/chat/sessions", async (req, res, next) => {
  try {
    success(res, await getChatSessions(req.user.openid));
  } catch (error) {
    next(error);
  }
});

router.get("/chat/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    success(res, await getChatMessages(req.user.openid, req.params.sessionId));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/chat/sessions/:sessionId/messages",
  chatSendRateLimiter,
  async (req, res, next) => {
  try {
    success(
      res,
      await sendChatMessage(
        req.user.openid,
        req.params.sessionId,
        req.body || {},
      ),
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;

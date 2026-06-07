const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const authMiddleware = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");
const { loginWithWechat } = require("../services/authService");
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
} = require("../services/shared");

const router = express.Router();

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

function createDiskStorage(folderName) {
  const targetDir = path.join(env.uploadRoot, folderName);
  ensureDir(targetDir);
  return multer.diskStorage({
    destination(req, file, cb) {
      cb(null, targetDir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || "") || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2, 8)}${ext}`);
    },
  });
}

const imageFileFilter = (req, file, cb) => {
  if (!/^image\//.test(file.mimetype || "")) {
    cb(new Error("仅支持上传图片文件"));
    return;
  }
  cb(null, true);
};

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

router.post("/auth/login", async (req, res, next) => {
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

router.get("/auth/diagnose", async (req, res, next) => {
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
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new Error("未收到上传文件");
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

router.post("/orders", async (req, res, next) => {
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
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new Error("未收到上传文件");
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
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new Error("未收到上传文件");
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
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new Error("未收到上传文件");
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

router.post("/wallet/withdrawals", async (req, res, next) => {
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
      await getOrderList(req.user.openid, req.query.status || "all"),
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

router.post("/chat/sessions/:sessionId/messages", async (req, res, next) => {
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

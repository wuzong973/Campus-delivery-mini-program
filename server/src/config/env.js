const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, "../../.env");
if (fs.existsSync(envPath)) {
  // override 必须为 false：真实环境变量（systemd / docker / 面板注入）优先级
  // 应当高于 .env 文件。此前用 override: true 会让 .env 反向覆盖外部配置 ——
  // 例如运维显式设置了 NODE_ENV=production，却被文件里的 development 悄悄改回去，
  // 直接导致生产以开发模式运行、并跳过 JWT_SECRET 的强制校验。
  dotenv.config({ path: envPath, override: false });
}

function readFileIfExists(filePath) {
  if (!filePath) {
    return "";
  }

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(__dirname, "../../", filePath);

  if (!fs.existsSync(absolutePath)) {
    return "";
  }

  return fs.readFileSync(absolutePath, "utf8");
}

function trimValue(value, fallback = "") {
  const text = value == null ? fallback : value;
  return String(text).trim();
}

function splitList(value) {
  return trimValue(value)
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const DEV_JWT_SECRET = crypto.randomBytes(32).toString("hex");

/**
 * 解析 JWT 密钥。
 * 生产环境必须显式注入 JWT_SECRET，避免使用开发密钥签发 token。
 */
function resolveJwtSecret(nodeEnv) {
  const fromEnv = trimValue(process.env.JWT_SECRET);

  if (fromEnv) {
    if (fromEnv.length < 32) {
      if (nodeEnv === "production") {
        throw new Error(
          "生产环境 JWT_SECRET 至少需要 32 位，请注入足够长的随机字符串。",
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        "[env] JWT_SECRET 长度不足 32 位，建议使用足够长的随机字符串。",
      );
    }
    return fromEnv;
  }

  if (nodeEnv === "production") {
    throw new Error(
      "生产环境缺少 JWT_SECRET，拒绝以不安全的密钥启动服务。" +
        "请生成一个足够长的随机字符串并注入 JWT_SECRET 环境变量。",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    "[env] 未配置 JWT_SECRET，当前使用进程内随机开发密钥；重启服务后现有 token 将失效，请勿用于生产环境。",
  );
  return DEV_JWT_SECRET;
}

const nodeEnv = trimValue(process.env.NODE_ENV, "development");

const env = {
  nodeEnv,
  port: Number(process.env.PORT || 3000),
  mongoUri: trimValue(
    process.env.MONGODB_URI,
    "mongodb://127.0.0.1:27017/campus_runner",
  ),
  jwtSecret: resolveJwtSecret(nodeEnv),

  publicBaseUrl: trimValue(process.env.PUBLIC_BASE_URL),
  appId: trimValue(process.env.WECHAT_APP_ID),
  appSecret: trimValue(process.env.WECHAT_APP_SECRET, ""),
  adminOpenids: splitList(process.env.ADMIN_OPENIDS),
  // 允许跨域访问的浏览器来源白名单。小程序请求不带 Origin，不受此限制。
  // 留空表示不放行任何浏览器跨域请求（最安全）。
  corsOrigins: splitList(process.env.CORS_ORIGINS),
  uploadRoot: process.env.UPLOAD_ROOT
    ? path.resolve(process.env.UPLOAD_ROOT)
    : path.resolve(__dirname, "../../uploads"),
  wechatPay: {
    mchId: trimValue(process.env.WECHAT_PAY_MCH_ID),
    apiV2Key: trimValue(process.env.WECHAT_PAY_API_V2_KEY, ""),
    apiV3Key: trimValue(process.env.WECHAT_PAY_API_V3_KEY, ""),
    notifyUrl: trimValue(process.env.WECHAT_PAY_NOTIFY_URL),
    serialNo: trimValue(process.env.WECHAT_PAY_SERIAL_NO, ""),
    platformSerialNo: trimValue(process.env.WECHAT_PAY_PLATFORM_SERIAL_NO, ""),
    publicKeyId: trimValue(process.env.WECHAT_PAY_PUBLIC_KEY_ID),
    publicKey: trimValue(
      process.env.WECHAT_PAY_PUBLIC_KEY ||
        readFileIfExists(process.env.WECHAT_PAY_PUBLIC_KEY_PATH),
      "",
    ),
    privateKey: trimValue(
      process.env.WECHAT_PAY_PRIVATE_KEY ||
        readFileIfExists(process.env.WECHAT_PAY_PRIVATE_KEY_PATH),
      "",
    ),
    merchantCert: trimValue(
      process.env.WECHAT_PAY_MERCHANT_CERT ||
        readFileIfExists(process.env.WECHAT_PAY_MERCHANT_CERT_PATH),
      "",
    ),
  },
};

module.exports = env;

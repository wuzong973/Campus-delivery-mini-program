const fs = require("fs");
const path = require("path");
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

const DEV_JWT_SECRET = "campus-runner-dev-secret";

/**
 * 解析 JWT 密钥。
 * 生产环境必须显式注入 JWT_SECRET —— 一旦回退到内置的公开默认值，
 * 任何人都能用它自签任意 openid 的 token，等同于全站失守，因此直接拒绝启动。
 */
function resolveJwtSecret(nodeEnv) {
  const fromEnv = trimValue(process.env.JWT_SECRET);

  // 显式配置且不是那个公开的开发默认值时才算有效
  if (fromEnv && fromEnv !== DEV_JWT_SECRET) {
    if (fromEnv.length < 32) {
      // eslint-disable-next-line no-console
      console.warn(
        "[env] JWT_SECRET 长度不足 32 位，建议使用足够长的随机字符串。",
      );
    }
    return fromEnv;
  }

  if (nodeEnv === "production") {
    throw new Error(
      "生产环境缺少（或仍在使用默认的）JWT_SECRET，拒绝以不安全的密钥启动服务。" +
        "请生成一个足够长的随机字符串并注入 JWT_SECRET 环境变量。",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    "[env] 未配置 JWT_SECRET，当前使用开发默认密钥，请勿用于生产环境。",
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

  publicBaseUrl: trimValue(
    process.env.PUBLIC_BASE_URL,
    "https://wzl136122.cn",
  ),
  appId: trimValue(process.env.WECHAT_APP_ID, "wx4f4f74eaf4b7d100"),
  appSecret: trimValue(process.env.WECHAT_APP_SECRET, ""),
  adminOpenids: splitList(process.env.ADMIN_OPENIDS),
  // 允许跨域访问的浏览器来源白名单。小程序请求不带 Origin，不受此限制。
  // 留空表示不放行任何浏览器跨域请求（最安全）。
  corsOrigins: splitList(process.env.CORS_ORIGINS),
  uploadRoot: process.env.UPLOAD_ROOT
    ? path.resolve(process.env.UPLOAD_ROOT)
    : path.resolve("/www/wwwroot/wzl136122.cn/server/uploads"),
  wechatPay: {
    mchId: trimValue(process.env.WECHAT_PAY_MCH_ID, "1110927390"),
    apiV2Key: trimValue(process.env.WECHAT_PAY_API_V2_KEY, ""),
    apiV3Key: trimValue(process.env.WECHAT_PAY_API_V3_KEY, ""),
    notifyUrl: trimValue(
      process.env.WECHAT_PAY_NOTIFY_URL,
      "https://wzl136122.cn/pay_notify.php",
    ),
    serialNo: trimValue(process.env.WECHAT_PAY_SERIAL_NO, ""),
    platformSerialNo: trimValue(process.env.WECHAT_PAY_PLATFORM_SERIAL_NO, ""),
    publicKeyId: trimValue(
      process.env.WECHAT_PAY_PUBLIC_KEY_ID,
      "PUB_KEY_ID_0111109273902026040900111545002400",
    ),
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

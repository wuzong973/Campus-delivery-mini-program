const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, "../../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
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

const env = {
  nodeEnv: trimValue(process.env.NODE_ENV, "development"),
  port: Number(process.env.PORT || 3000),
  mongoUri: trimValue(
    process.env.MONGODB_URI,
    "mongodb://127.0.0.1:27017/campus_runner",
  ),
  jwtSecret: trimValue(
    process.env.JWT_SECRET,
    require("crypto").randomBytes(32).toString("hex"),
  ),
  publicBaseUrl: trimValue(
    process.env.PUBLIC_BASE_URL,
    "https://YOUR_API_HOST",
  ),
  appId: trimValue(process.env.WECHAT_APP_ID, "YOUR_WECHAT_APP_ID"),
  appSecret: trimValue(process.env.WECHAT_APP_SECRET, ""),
  adminOpenids: splitList(process.env.ADMIN_OPENIDS),
  uploadRoot: process.env.UPLOAD_ROOT
    ? path.resolve(process.env.UPLOAD_ROOT)
    : path.resolve("[REDACTED_SERVER_ROOT]/YOUR_API_HOST/server/uploads"),
  wechatPay: {
    mchId: trimValue(process.env.WECHAT_PAY_MCH_ID, "YOUR_MERCHANT_ID"),
    apiV2Key: trimValue(process.env.WECHAT_PAY_API_V2_KEY, ""),
    apiV3Key: trimValue(process.env.WECHAT_PAY_API_V3_KEY, ""),
    notifyUrl: trimValue(
      process.env.WECHAT_PAY_NOTIFY_URL,
      "https://YOUR_API_HOST/pay_notify.php",
    ),
    serialNo: trimValue(process.env.WECHAT_PAY_SERIAL_NO, ""),
    platformSerialNo: trimValue(process.env.WECHAT_PAY_PLATFORM_SERIAL_NO, ""),
    publicKeyId: trimValue(
      process.env.WECHAT_PAY_PUBLIC_KEY_ID,
      "PUB_KEY_ID_01YOUR_MERCHANT_ID2026040900111545002400",
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

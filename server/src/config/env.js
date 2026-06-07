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
    "campus-runner-dev-secret",
  ),
  publicBaseUrl: trimValue(
    process.env.PUBLIC_BASE_URL,
    "https://wzl136122.cn",
  ),
  appId: trimValue(process.env.WECHAT_APP_ID, "wx4f4f74eaf4b7d100"),
  appSecret: trimValue(process.env.WECHAT_APP_SECRET, ""),
  adminOpenids: splitList(process.env.ADMIN_OPENIDS),
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

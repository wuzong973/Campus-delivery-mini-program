const crypto = require("crypto");
const axios = require("axios");

const env = require("./env");

const WECHAT_PAY_BASE_URL = "https://api.mch.weixin.qq.com";

function normalizePem(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function isCertificatePem(value) {
  return /BEGIN CERTIFICATE/.test(String(value || ""));
}

function isPublicKeyPem(value) {
  return /BEGIN PUBLIC KEY/.test(String(value || ""));
}

function createWechatPayError(message, statusCode = 500, code = "WECHAT_PAY_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getMerchantSerialNo() {
  const configured = String(env.wechatPay.serialNo || "")
    .replace(/:/g, "")
    .trim()
    .toUpperCase();
  const merchantCert = normalizePem(env.wechatPay.merchantCert);

  if (!merchantCert || !isCertificatePem(merchantCert)) {
    return configured;
  }

  try {
    const cert = new crypto.X509Certificate(merchantCert);
    const parsed = String(cert.serialNumber || "")
      .replace(/:/g, "")
      .trim()
      .toUpperCase();
    return parsed || configured;
  } catch (error) {
    return configured;
  }
}

function getWechatPayPublicKey() {
  const raw = normalizePem(env.wechatPay.publicKey);
  if (!raw) {
    return "";
  }

  if (isPublicKeyPem(raw)) {
    return raw;
  }

  if (isCertificatePem(raw)) {
    const cert = new crypto.X509Certificate(raw);
    return cert.publicKey.export({ type: "spki", format: "pem" }).toString();
  }

  return raw;
}

function ensureWechatPayConfig() {
  const missing = [];

  if (!env.appId) missing.push("WECHAT_APP_ID");
  if (!env.wechatPay.mchId) missing.push("WECHAT_PAY_MCH_ID");
  if (!env.wechatPay.apiV3Key) missing.push("WECHAT_PAY_API_V3_KEY");
  if (!env.wechatPay.notifyUrl) missing.push("WECHAT_PAY_NOTIFY_URL");
  if (!getMerchantSerialNo()) missing.push("WECHAT_PAY_SERIAL_NO or merchant cert");
  if (!normalizePem(env.wechatPay.privateKey)) {
    missing.push("WECHAT_PAY_PRIVATE_KEY");
  }

  if (missing.length) {
    throw createWechatPayError(
      `微信支付配置缺失: ${missing.join(", ")}`,
      500,
      "WECHAT_PAY_CONFIG_MISSING",
    );
  }
}

function signWithPrivateKey(content) {
  const privateKey = normalizePem(env.wechatPay.privateKey);
  return crypto
    .createSign("RSA-SHA256")
    .update(content)
    .end()
    .sign(privateKey, "base64");
}

function buildAuthorization(method, pathname, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString("hex");
  const message = `${method}\n${pathname}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = signWithPrivateKey(message);

  return {
    authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${env.wechatPay.mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${getMerchantSerialNo()}",signature="${signature}"`,
    timestamp,
    nonceStr,
  };
}

function extractAxiosError(error, fallbackMessage) {
  const response = error && error.response;
  let payload = response && response.data;

  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (parseError) {
      payload = { message: payload };
    }
  }

  if (payload && typeof payload === "object") {
    return {
      code: payload.code || "",
      message:
        payload.message ||
        payload.detail ||
        error.message ||
        fallbackMessage,
      payload,
      statusCode: response ? response.status : undefined,
    };
  }

  return {
    code: "",
    message: (error && error.message) || fallbackMessage,
    payload: payload || null,
    statusCode: response ? response.status : undefined,
  };
}

async function requestWechatPay({ method, pathname, body, timeout = 10000 }) {
  ensureWechatPayConfig();

  const requestBody = body || "";
  const auth = buildAuthorization(method, pathname, requestBody);

  try {
    const response = await axios({
      url: `${WECHAT_PAY_BASE_URL}${pathname}`,
      method,
      data: requestBody || undefined,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: auth.authorization,
        "User-Agent": "campus-runner-server",
      },
      proxy: false,
      timeout,
    });

    return response.data || {};
  } catch (error) {
    const normalized = extractAxiosError(error, "微信支付请求失败");
    const codeText = normalized.code ? `${normalized.code}: ` : "";
    const wrapped = createWechatPayError(
      `微信支付接口失败，${codeText}${normalized.message}`,
      normalized.statusCode || 500,
      normalized.code || "WECHAT_PAY_HTTP_FAIL",
    );
    wrapped.payload = normalized.payload;
    throw wrapped;
  }
}

async function createJsapiPrepay({ description, outTradeNo, total, openid }) {
  const response = await requestWechatPay({
    method: "POST",
    pathname: "/v3/pay/transactions/jsapi",
    body: JSON.stringify({
      appid: env.appId,
      mchid: env.wechatPay.mchId,
      description,
      out_trade_no: outTradeNo,
      notify_url: env.wechatPay.notifyUrl,
      amount: {
        total,
        currency: "CNY",
      },
      payer: {
        openid,
      },
    }),
  });

  if (!response.prepay_id) {
    throw createWechatPayError(
      `微信预支付单创建失败，未返回 prepay_id: ${JSON.stringify(response)}`,
      500,
      "WECHAT_PAY_MISSING_PREPAY_ID",
    );
  }

  return response;
}

async function queryTransactionByOutTradeNo(outTradeNo) {
  if (!outTradeNo) {
    throw createWechatPayError("缺少商户订单号", 400, "MISSING_OUT_TRADE_NO");
  }

  return requestWechatPay({
    method: "GET",
    pathname: `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${env.wechatPay.mchId}`,
    body: "",
  });
}

function buildMiniProgramPayArgs(prepayId) {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString("hex");
  const packageValue = `prepay_id=${prepayId}`;
  const signType = "RSA";
  const message = `${env.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  const paySign = signWithPrivateKey(message);

  return {
    appId: env.appId,
    timeStamp,
    nonceStr,
    package: packageValue,
    signType,
    paySign,
  };
}

function verifyCallbackSignature({ timestamp, nonce, body, signature }) {
  const publicKey = getWechatPayPublicKey();
  if (!publicKey) {
    return true;
  }

  const message = `${timestamp}\n${nonce}\n${body}\n`;
  return crypto
    .createVerify("RSA-SHA256")
    .update(message)
    .end()
    .verify(publicKey, signature, "base64");
}

function decryptCallbackResource(resource) {
  const key = Buffer.from(String(env.wechatPay.apiV3Key).trim());
  const nonce = Buffer.from(resource.nonce);
  const associatedData = Buffer.from(resource.associated_data || "");
  const ciphertext = Buffer.from(resource.ciphertext, "base64");
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);

  decipher.setAuthTag(authTag);
  if (associatedData.length) {
    decipher.setAAD(associatedData);
  }

  const decoded = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decoded.toString("utf8"));
}

async function createRefund({ outTradeNo, outRefundNo, reason, total, refund }) {
  return requestWechatPay({
    method: "POST",
    pathname: "/v3/refund/domestic/refunds",
    body: JSON.stringify({
      out_trade_no: outTradeNo,
      out_refund_no: outRefundNo,
      reason,
      notify_url: env.wechatPay.notifyUrl,
      amount: {
        refund,
        total,
        currency: "CNY",
      },
    }),
  });
}

async function queryRefundByOutRefundNo(outRefundNo) {
  if (!outRefundNo) {
    throw createWechatPayError("缺少退款单号", 400, "MISSING_OUT_REFUND_NO");
  }

  return requestWechatPay({
    method: "GET",
    pathname: `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`,
    body: "",
  });
}

module.exports = {
  ensureWechatPayConfig,
  createJsapiPrepay,
  queryTransactionByOutTradeNo,
  queryRefundByOutRefundNo,
  buildMiniProgramPayArgs,
  verifyCallbackSignature,
  decryptCallbackResource,
  createRefund,
  getMerchantSerialNo,
};

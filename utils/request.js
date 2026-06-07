const config = require("./config");

const TOKEN_KEY = "CAMPUS_RUNNER_TOKEN";
const AUTH_HEADER_KEY = "Authorization";
const DEFAULT_TIMEOUT = 10000;
const UPLOAD_TIMEOUT = 60000;

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) {
    wx.setStorageSync(TOKEN_KEY, token);
  } else {
    wx.removeStorageSync(TOKEN_KEY);
  }
}

function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
}

function buildUrl(path) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${config.apiBaseUrl}${normalizedPath}`;
}

function createError(message, code, extra) {
  const error = new Error(message);
  error.code = code || "REQUEST_ERROR";
  if (extra) {
    Object.assign(error, extra);
  }
  return error;
}

function stringifyPayload(payload) {
  if (payload == null) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch (error) {
    return "";
  }
}

function extractBusinessMessage(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      return extractBusinessMessage(parsed);
    } catch (error) {
      return payload;
    }
  }

  if (typeof payload === "object") {
    return String(payload.message || payload.error || "");
  }

  return "";
}

function mapRequestFailError(error) {
  const message = String((error && (error.errMsg || error.message)) || "");

  if (/timeout|timed out|超时/i.test(message)) {
    return createError("请求超时，请检查网络后重试。", "NETWORK_TIMEOUT");
  }

  if (/ssl|certificate|证书/i.test(message)) {
    return createError("HTTPS 证书校验失败，请检查服务端证书配置。", "SSL_ERROR");
  }

  if (/domain list|合法域名|not in domain list/i.test(message)) {
    return createError(
      "当前域名未配置到小程序合法域名列表，请检查微信公众平台配置。",
      "INVALID_DOMAIN",
    );
  }

  if (/connection reset|reset by peer|CONNECTION_RESET/i.test(message)) {
    return createError(
      "无法连接服务器，请检查后端服务、域名和 HTTPS 配置。",
      "NETWORK_RESET",
    );
  }

  return createError(message || "网络请求失败", "NETWORK_FAIL");
}

function normalizeResponse(response) {
  const data =
    response && response.data !== undefined ? response.data : response || {};

  if (data.success === false) {
    throw createError(data.message || "请求失败", data.code || "BUSINESS_FAIL", {
      payload: data,
    });
  }

  return data.data !== undefined ? data.data : data;
}

function buildHttpError(statusCode, payload) {
  const businessMessage = extractBusinessMessage(payload);
  const bodyText = stringifyPayload(payload);
  const isHtmlPayload =
    typeof bodyText === "string" && /<!DOCTYPE html>|<html[\s>]/i.test(bodyText);

  if (statusCode === 401) {
    return createError(
      businessMessage || "登录状态已失效，请重新登录。",
      "AUTH_EXPIRED",
      {
        statusCode,
        payload,
      },
    );
  }

  if (statusCode === 404) {
    return createError(
      isHtmlPayload
        ? "接口不存在，请确认后端已部署并重启到最新版本。"
        : businessMessage || "请求的接口不存在。",
      "HTTP_NOT_FOUND",
      {
        statusCode,
        payload,
      },
    );
  }

  const shortBody =
    bodyText && bodyText.length > 240 ? `${bodyText.slice(0, 240)}...` : bodyText;

  return createError(
    businessMessage || (shortBody ? `服务器返回 ${statusCode}: ${shortBody}` : `服务器返回 ${statusCode}`),
    "HTTP_ERROR",
    {
      statusCode,
      payload,
    },
  );
}

function shouldRetryAuth(error, options) {
  return (
    error &&
    error.code === "AUTH_EXPIRED" &&
    options &&
    options.url !== "/auth/login" &&
    !options.__retryAfterAuth
  );
}

function reloginAndRetry(options, runner) {
  const auth = require("./auth");

  return auth
    .login(true)
    .then(() =>
      runner(
        Object.assign({}, options, {
          __retryAfterAuth: true,
        }),
      ),
    )
    .catch((error) => {
      auth.clearSession();
      throw createError(
        (error && error.message) || "登录状态已失效，请重新进入小程序后再试。",
        "AUTH_EXPIRED",
      );
    });
}

function request(options) {
  const headers = Object.assign(
    {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    (options && options.header) || {},
  );

  const token = getToken();
  if (token) {
    headers[AUTH_HEADER_KEY] = `Bearer ${token}`;
    headers["x-access-token"] = token;
  }

  const method = String((options && options.method) || "GET").toUpperCase();
  const requestData = Object.assign({}, (options && options.data) || {});
  if (method === "GET") {
    requestData._t = Date.now();
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(options.url),
      method,
      data: requestData,
      header: headers,
      timeout:
        options && typeof options.timeout === "number"
          ? options.timeout
          : DEFAULT_TIMEOUT,
      success(response) {
        const statusCode = response && response.statusCode;

        if (
          typeof statusCode === "number" &&
          (statusCode < 200 || statusCode >= 300)
        ) {
          reject(buildHttpError(statusCode, response.data));
          return;
        }

        try {
          resolve(normalizeResponse(response));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        reject(mapRequestFailError(error));
      },
    });
  }).catch((error) => {
    if (shouldRetryAuth(error, options)) {
      return reloginAndRetry(options, request);
    }
    throw error;
  });
}

function upload(options) {
  const token = getToken();
  const headers = Object.assign({}, (options && options.header) || {});

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: buildUrl(options.url),
      filePath: options.filePath,
      name: options.name || "file",
      formData: options.formData || {},
      header: headers,
      timeout:
        options && typeof options.timeout === "number"
          ? options.timeout
          : UPLOAD_TIMEOUT,
      success(response) {
        const statusCode = response && response.statusCode;

        if (
          typeof statusCode === "number" &&
          (statusCode < 200 || statusCode >= 300)
        ) {
          reject(buildHttpError(statusCode, response.data));
          return;
        }

        try {
          resolve(normalizeResponse(JSON.parse(response.data)));
        } catch (error) {
          reject(createError("上传响应解析失败", "UPLOAD_PARSE_FAIL"));
        }
      },
      fail(error) {
        reject(mapRequestFailError(error));
      },
    });
  }).catch((error) => {
    if (shouldRetryAuth(error, options)) {
      return reloginAndRetry(options, upload);
    }
    throw error;
  });
}

module.exports = {
  TOKEN_KEY,
  AUTH_HEADER_KEY,
  getToken,
  setToken,
  clearToken,
  request,
  upload,
};

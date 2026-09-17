const config = require("./config");
const request = require("./request");

const SESSION_KEY = "CAMPUS_RUNNER_SESSION";

let loginPromise = null;
let loginPromiseSequence = 0;

function getCachedSession() {
  return wx.getStorageSync(SESSION_KEY) || null;
}

function setCachedSession(session) {
  wx.setStorageSync(SESSION_KEY, session || null);
  return session;
}

function sanitizeSession(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return {
    mode: session.mode || "http",
    token: session.token || "",
    user: session.user || null,
    openid: session.openid || "",
  };
}

function updateCachedSession(result) {
  const session = sanitizeSession({
    mode: "http",
    token: result && result.token ? result.token : "",
    user: result && result.user ? result.user : null,
    openid: result && result.openid ? result.openid : "",
  });

  request.setToken(session.token);
  setCachedSession(session);
  return session;
}

function updateCachedUser(user) {
  const session = getCachedSession() || {};
  session.user = user || null;
  setCachedSession(session);
  return user;
}

function getCachedUser() {
  const session = getCachedSession();
  return session ? session.user || null : null;
}

function getOpenId() {
  const session = getCachedSession();
  return session ? session.openid || "" : "";
}

function initCloud() {
  return true;
}

function clearSession() {
  request.clearToken();
  wx.removeStorageSync(SESSION_KEY);
}

// 用 wx.login 的 code 换取会话。这是唯一合法的登入方式：
// openid 必须由服务端向微信换取，客户端不得自行提供（否则等于允许任意账号登录）。
function loginWithWechatCode(userInfo) {
  return new Promise((resolve, reject) => {
    wx.login({
      success(loginRes) {
        if (!loginRes || !loginRes.code) {
          reject(new Error("微信登录失败，未拿到登录 code"));
          return;
        }

        request
          .request({
            url: "/auth/login",
            method: "POST",
            data: {
              code: loginRes.code,
              userInfo: userInfo || null,
              appId: config.appId,
            },
          })
          .then((result) => resolve(updateCachedSession(result || {})))
          .catch((error) => {
            clearSession();
            reject(error);
          });
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || "微信登录失败"));
      },
    });
  });
}

// 用本地缓存的 token 向服务端校验会话是否仍然有效。
// skipAuthRetry：这里不希望 request 层自动重新登录，失败时由本模块统一决定
// 是否回退到 wx.login，避免出现两次并行登录、拿到两个不同的会话。
function restoreSession(session) {
  request.setToken(session.token);

  return request
    .request({
      url: "/auth/session",
      method: "GET",
      skipAuthRetry: true,
    })
    .then((result) =>
      updateCachedSession({
        token: session.token,
        openid: (result && result.openid) || session.openid,
        user: result && result.user,
      }),
    );
}

function runLogin(userInfo) {
  if (loginPromise) {
    return loginPromise;
  }

  const currentSeq = ++loginPromiseSequence;

  loginPromise = loginWithWechatCode(userInfo || null)
    .catch((error) => {
      clearSession();
      throw error;
    })
    .finally(() => {
      if (loginPromiseSequence === currentSeq) {
        loginPromise = null;
      }
    });

  return loginPromise;
}

function waitForLogin() {
  if (loginPromise) {
    return loginPromise;
  }

  const cachedSession = sanitizeSession(getCachedSession());

  // 没有可用 token，直接走微信登录
  if (!cachedSession || !cachedSession.token) {
    return runLogin(null);
  }

  // 有 token：先向服务端确认有效性，失效再回退到微信登录。
  // 注意这里不再像旧实现那样「有 token 就直接采信」——本地缓存可能已过期或被篡改。
  const currentSeq = ++loginPromiseSequence;

  loginPromise = restoreSession(cachedSession)
    .catch(() => {
      clearSession();
      return loginWithWechatCode(null);
    })
    .catch((error) => {
      clearSession();
      throw error;
    })
    .finally(() => {
      if (loginPromiseSequence === currentSeq) {
        loginPromise = null;
      }
    });

  return loginPromise;
}

function login(forceRefresh, userInfo) {
  if (forceRefresh) {
    return runLogin(userInfo || null);
  }

  return waitForLogin();
}

function ensureLogin() {
  return waitForLogin();
}

module.exports = {
  initCloud,
  login,
  ensureLogin,
  getCachedUser,
  getOpenId,
  updateCachedUser,
  updateCachedSession,
  clearSession,
  waitForLogin,
  isLocalDemo() {
    return false;
  },
  getRuntimeMode() {
    return "http";
  },
  getFallbackReason() {
    return "";
  },
  canFallbackToLocal() {
    return false;
  },
  switchToLocal() {
    return Promise.reject(new Error("当前项目已经切换为自建后端模式"));
  },
};

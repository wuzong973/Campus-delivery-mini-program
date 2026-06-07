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

function waitForLogin() {
  if (loginPromise) {
    return loginPromise;
  }

  const cachedSession = sanitizeSession(getCachedSession());
  if (cachedSession && cachedSession.token && cachedSession.openid) {
    request.setToken(cachedSession.token);
    setCachedSession(cachedSession);
    return Promise.resolve(cachedSession);
  }

  return login(false);
}

function login(forceRefresh, userInfo, openid) {
  if (!forceRefresh) {
    const cachedSession = sanitizeSession(getCachedSession());
    if (cachedSession && cachedSession.token && cachedSession.openid) {
      request.setToken(cachedSession.token);
      setCachedSession(cachedSession);
      return Promise.resolve(cachedSession);
    }

    if (loginPromise) {
      return loginPromise;
    }
  }

  const normalizedOpenid = String(openid || "").trim();
  const currentLoginSeq = ++loginPromiseSequence;

  if (normalizedOpenid) {
    loginPromise = request
      .request({
        url: "/auth/login",
        method: "POST",
        data: {
          openid: normalizedOpenid,
          userInfo: userInfo || null,
        },
      })
      .then((result) => updateCachedSession(result || {}))
      .catch((error) => {
        clearSession();
        throw error;
      })
      .finally(() => {
        if (loginPromiseSequence === currentLoginSeq) {
          loginPromise = null;
        }
      });

    return loginPromise;
  }

  loginPromise = new Promise((resolve, reject) => {
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
          .then((result) => {
            resolve(updateCachedSession(result || {}));
          })
          .catch((error) => {
            clearSession();
            reject(error);
          });
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || "微信登录失败"));
      },
    });
  }).finally(() => {
    if (loginPromiseSequence === currentLoginSeq) {
      loginPromise = null;
    }
  });

  return loginPromise;
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

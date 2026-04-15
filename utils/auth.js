const config = require('./config');
const { getServiceObject } = require('./cloudService');

const SESSION_KEY = 'CAMPUS_RUNNER_SESSION';

let cloudInitialized = false;
let loginPromise = null;

function getCachedSession() {
  return wx.getStorageSync(SESSION_KEY) || null;
}

function setCachedSession(session) {
  wx.setStorageSync(SESSION_KEY, session || null);
  return session;
}

function initCloud() {
  if (cloudInitialized) {
    return true;
  }

  if (!wx.cloud) {
    throw new Error('当前微信基础库不支持云开发，请升级微信开发者工具后重试');
  }

  wx.cloud.init({
    env: config.cloudEnvId || wx.cloud.DYNAMIC_CURRENT_ENV,
    traceUser: true
  });
  cloudInitialized = true;
  return true;
}

function updateCachedSession(result) {
  const session = {
    mode: 'cloud',
    user: result && result.user ? result.user : null,
    openid: result && result.openid ? result.openid : ''
  };

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
  return session ? session.openid || '' : '';
}

function login(forceRefresh, userInfo) {
  initCloud();

  if (!forceRefresh) {
    const cachedSession = getCachedSession();
    if (cachedSession && cachedSession.openid) {
      return Promise.resolve(cachedSession);
    }
    if (loginPromise) {
      return loginPromise;
    }
  }

  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success(loginRes) {
        getServiceObject().weappLogin({
          code: loginRes.code,
          userInfo: userInfo || null
        }).then(result => {
          resolve(updateCachedSession(result || {}));
        }).catch(reject);
      },
      fail: reject
    });
  }).finally(() => {
    loginPromise = null;
  });

  return loginPromise;
}

function ensureLogin() {
  return login(false);
}

module.exports = {
  initCloud,
  login,
  ensureLogin,
  getCachedUser,
  getOpenId,
  updateCachedUser,
  updateCachedSession,
  isLocalDemo() {
    return false;
  },
  getRuntimeMode() {
    return 'cloud';
  },
  getFallbackReason() {
    return '';
  },
  canFallbackToLocal() {
    return false;
  },
  switchToLocal() {
    return Promise.reject(new Error('项目已切换为纯云开发模式，请检查云环境配置'));
  }
};

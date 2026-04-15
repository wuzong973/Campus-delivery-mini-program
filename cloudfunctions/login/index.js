const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

function success(data) {
  return {
    success: true,
    data,
  };
}

function fail(message) {
  return {
    success: false,
    message,
  };
}

function getAvatarText(name) {
  return name ? String(name).trim().slice(0, 1) : "我";
}

function getProfileState(user) {
  const missingFields = [];

  if (!String((user && user.nickname) || "").trim()) missingFields.push("昵称");
  if (!/^1\d{10}$/.test(String((user && user.phone) || "").trim()))
    missingFields.push("手机号");
  if (!String((user && user.commonAddress) || "").trim())
    missingFields.push("常用地址");

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    missingText: missingFields.join("、"),
  };
}

function normalizeUser(user) {
  const profileState = getProfileState(user || {});

  return {
    id: user._id,
    openid: user.openid || user._openid || "",
    nickname: user.nickname || "校园同学",
    phone: user.phone || "",
    commonAddress: user.commonAddress || "",
    avatarTheme: user.avatarTheme || "ocean",
    avatarText: getAvatarText(user.nickname || "我"),
    slogan: user.slogan || "",
    role: user.role || "user",
    completedJobs: user.completedJobs || 0,
    averageScore: user.averageScore || 0,
    ratingText: Number(user.averageScore || 0).toFixed(1),
    walletBalance: user.walletBalance || 0,
    totalIncome: user.totalIncome || 0,
    totalWithdrawn: user.totalWithdrawn || 0,
    avatarUrl: user.avatarUrl || "",
    profileComplete: profileState.isComplete,
    missingProfileFields: profileState.missingFields,
    missingProfileText: profileState.missingText,
  };
}

async function getCurrentUser(openid) {
  let result = await db
    .collection("users")
    .where({
      openid,
    })
    .limit(1)
    .get();

  if (!result.data.length) {
    result = await db
      .collection("users")
      .where({
        _openid: openid,
      })
      .limit(1)
      .get();
  }

  return result.data[0] || null;
}

function parseAdminOpenIds() {
  const raw = process.env.ADMIN_OPENIDS || "";
  return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

function shouldGrantAdminOnRegister(openid) {
  const list = parseAdminOpenIds();
  return list.length > 0 && list.includes(openid);
}

async function ensureLoginUser(openid, event) {
  let user = await getCurrentUser(openid);
  const { code, userInfo } = event;

  if (!user) {
    const userData = {
      openid,
      nickname: userInfo ? userInfo.nickName : "校园同学",
      avatarUrl: userInfo ? userInfo.avatarUrl : "",
      phone: "",
      commonAddress: "",
      avatarTheme: "ocean",
      slogan: userInfo
        ? "已同步微信昵称和头像"
        : "微信登录已接入，欢迎完善个人信息",
      role: shouldGrantAdminOnRegister(openid) ? "admin" : "user",
      completedJobs: 0,
      averageScore: 0,
      walletBalance: 0,
      totalIncome: 0,
      totalWithdrawn: 0,
      totalSpending: 0,
      lastLoginCode: code || "",
      loginCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    };

    const addResult = await db.collection("users").add({
      data: userData,
    });

    user = Object.assign(
      {
        _id: addResult._id,
        _openid: openid,
      },
      userData,
    );
  } else {
    await db
      .collection("users")
      .doc(user._id)
      .update({
        data: {
          openid,
          lastLoginCode: code || "",
          loginCount: _.inc(1),
          lastLoginAt: Date.now(),
          updatedAt: Date.now(),
        },
      });

    user = Object.assign({}, user, {
      loginCount: (user.loginCount || 0) + 1,
      lastLoginCode: code || "",
      lastLoginAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return user;
}

async function updateProfile(openid, payload) {
  if (!payload.nickname || !payload.nickname.trim()) {
    throw new Error("请输入昵称");
  }

  if (!/^1\d{10}$/.test(payload.phone || "")) {
    throw new Error("请输入正确的联系方式");
  }

  if (!payload.commonAddress || !payload.commonAddress.trim()) {
    throw new Error("请输入常用地址");
  }

  const user = await getCurrentUser(openid);

  if (!user) {
    throw new Error("用户不存在，请重新登录");
  }

  const data = {
    nickname: payload.nickname.trim(),
    phone: payload.phone.trim(),
    commonAddress: payload.commonAddress.trim(),
    slogan: (payload.slogan || "").trim(),
    avatarTheme: payload.avatarTheme || "ocean",
    avatarUrl: payload.avatarUrl || user.avatarUrl || "",
    updatedAt: Date.now(),
  };

  await db.collection("users").doc(user._id).update({
    data,
  });

  return normalizeUser(Object.assign({}, user, data));
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;

  try {
    switch (event.action) {
      case "login": {
        const user = await ensureLoginUser(openid, event);
        return success({
          openid,
          user: normalizeUser(user),
        });
      }
      case "getProfile": {
        const user = await getCurrentUser(openid);

        if (!user) {
          throw new Error("用户不存在，请重新登录");
        }

        return success(normalizeUser(user));
      }
      case "updateProfile": {
        const profile = await updateProfile(openid, event.payload || {});
        return success(profile);
      }
      default:
        return fail("不支持的操作类型");
    }
  } catch (error) {
    return fail(error.message || "云函数执行失败");
  }
};

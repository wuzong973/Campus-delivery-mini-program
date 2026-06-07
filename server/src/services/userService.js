const { publicBaseUrl } = require("../config/env");
const {
  isPhone,
  now,
  normalizeUser,
  getCurrentUser,
  getProfileState,
  User,
} = require("./shared");

async function getMe(openid) {
  const user = await getCurrentUser(openid);
  if (!user) {
    throw new Error("用户不存在，请重新登录");
  }
  return normalizeUser(user, publicBaseUrl);
}

async function updateMe(openid, payload) {
  if (!payload || !String(payload.nickname || "").trim()) {
    throw new Error("请输入昵称");
  }
  if (!isPhone(payload.phone)) {
    throw new Error("请输入正确的手机号");
  }
  if (!String(payload.commonAddress || "").trim()) {
    throw new Error("请输入常用地址");
  }

  const user = await getCurrentUser(openid);
  if (!user) {
    throw new Error("用户不存在，请重新登录");
  }

  const patch = {
    nickname: String(payload.nickname || "").trim(),
    phone: String(payload.phone || "").trim(),
    commonAddress: String(payload.commonAddress || "").trim(),
    slogan: String(payload.slogan || "").trim(),
    avatarTheme: payload.avatarTheme || "ocean",
    avatarUrl: payload.avatarUrl || user.avatarUrl || "",
    updatedAt: now(),
  };

  await User.updateOne({ _id: user._id }, { $set: patch });
  return normalizeUser(
    {
      ...user,
      ...patch,
    },
    publicBaseUrl,
  );
}

async function getMineData(openid) {
  const user = await getCurrentUser(openid);
  if (!user) {
    throw new Error("用户不存在，请重新登录");
  }

  const profile = normalizeUser(user);
  return {
    profile: {
      ...profile,
      profileState: getProfileState(user),
    },
  };
}

module.exports = {
  getMe,
  updateMe,
  getMineData,
};

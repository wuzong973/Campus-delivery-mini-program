const jwt = require("jsonwebtoken");
const env = require("../config/env");

function signToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      openid: user.openid,
      role: user.role || "user",
    },
    env.jwtSecret,
    {
      expiresIn: "7d",
    },
  );
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = {
  signToken,
  verifyToken,
};

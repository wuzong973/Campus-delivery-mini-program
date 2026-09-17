/**
 * 通用输入校验工具。
 */

// 微信 openid 只包含字母、数字、下划线、连字符，长度不超过 64。
// 做这个白名单校验有两个作用：
//   1. 拦截伪造的非法 openid
//   2. 防止 openid 被拼进 MongoDB 更新路径（如 unreadCounts.<openid>）时
//      因包含 "." 或 "$" 而改变查询语义
const OPENID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isValidOpenid(openid) {
  return OPENID_PATTERN.test(String(openid || ""));
}

module.exports = {
  OPENID_PATTERN,
  isValidOpenid,
};

# 云函数部署说明

## 安装依赖

每个云函数目录若包含 `package.json`，在微信开发者工具上传前于该目录执行：

```bash
npm install
```

不要将 `node_modules` 提交到版本库；仓库根目录 `.gitignore` 已忽略。

## 环境变量（云开发控制台 → 云函数 → 配置）

支付相关（`finance`、`payUnifiedOrder`、`wxpayFunctions` 等）：

- `WECHAT_PAY_APP_ID`：小程序 AppID（可与 `APPID` 二选一）
- `WECHAT_PAY_MCH_ID`：商户号（可与 `MCHID` 二选一）
- `WECHAT_PAY_API_V2_KEY`：APIv2 密钥（可与 `API_KEY_V2` 二选一）
- `WECHAT_PAY_NOTIFY_URL`：支付结果通知 URL（可与 `NOTIFY_URL` 二选一）

管理员注册（`login`）：

- `ADMIN_OPENIDS`：英文逗号或分号分隔的 OpenID 列表；**仅**在此列表中的新注册用户会被写入 `role: admin`，其余新用户为 `user`。首用户不再自动成为管理员。

## 安全说明

- 小程序端仅调用 `campusService`；用户身份以该函数内的 `cloud.getWXContext().OPENID` 为准，勿信任客户端传入的 `openid`。
- 子云函数（`login`、`order`、`finance`、`admin` 等）可能被其它云函数通过 `callFunction` 调用，此时使用 `wxContext.OPENID || event.openid`，其中 `event.openid` 应由上游云函数从自己的 `OPENID` 传入。

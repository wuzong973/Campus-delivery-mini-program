# 校园代拿小程序

本项目已从腾讯云开发主链路迁移为“微信小程序 + Express + MongoDB”架构。

## 当前架构
- 小程序前端通过 `wx.request` / `wx.uploadFile` 访问 `https://YOUR_API_HOST/api`
- 服务端位于 `server/`，使用 `Express + Mongoose`
- 图片上传到服务器本地目录 `server/uploads/`
- 微信支付回调地址固定为 `https://YOUR_API_HOST/pay_notify.php`
- 旧 `cloudfunctions/` 目录保留为历史参考，不再作为运行主链路

## 已写入的公开配置
- 小程序 AppID: `YOUR_WECHAT_APP_ID`
- API 域名: `https://YOUR_API_HOST/api`
- 上传域名: `https://YOUR_API_HOST/uploads`
- 微信支付商户号: `YOUR_MERCHANT_ID`
- 微信支付回调地址: `https://YOUR_API_HOST/pay_notify.php`
- 微信支付公钥 ID: `PUB_KEY_ID_01YOUR_MERCHANT_ID2026040900111545002400`
- API 证书序列号: `YOUR_CERTIFICATE_SERIAL`

## 敏感信息放置方式
敏感信息不要写入前端代码或提交到 git。

本仓库已为服务端准备好以下本地忽略文件：
- `server/.env`
- `server/certs/merchant_private_key.pem`
- `server/certs/wechat_pay_public_key.pem`
- `server/certs/merchant_cert.pem`

示例模板位于：
- `server/.env.example`

## 服务端启动
```bash
cd server
npm install
npm run start
```

默认端口：
- `3000`

默认 MongoDB：
- `mongodb://127.0.0.1:27017/campus_runner`

## Nginx 部署
Nginx 配置示例：
- `deploy/nginx/YOUR_API_HOST.conf`

反向代理规则：
- `/api/*` -> Express
- `/uploads/*` -> 本地静态文件
- `/pay_notify.php` -> Express 支付回调

## 已迁移的接口
- `POST /api/auth/login`
- `GET /api/users/me`
- `PATCH /api/users/me`
- `GET /api/home`
- `POST /api/orders`
- `GET /api/tasks`
- `GET /api/orders/:id`
- `POST /api/orders/:id/accept`
- `POST /api/orders/:id/favorite`
- `DELETE /api/orders/:id/favorite`
- `POST /api/orders/:id/cancel`
- `POST /api/orders/:id/complete`
- `POST /api/orders/:id/rate`
- `POST /api/orders/:id/pay`
- `GET /api/orders/:id/payment-status`
- `POST /api/files/order-attachments`
- `POST /api/files/delivery-proof`
- `GET /api/wallet`
- `POST /api/wallet/withdrawals`
- `GET /api/mine`
- `GET /api/orders`
- `GET /api/admin/dashboard`
- `POST /api/admin/withdrawals/:id/audit`
- `POST /pay_notify.php`

## 历史数据迁移
提供了一次性迁移脚本：

```bash
cd server
npm run migrate:cloud-export -- ../server/data/cloud-export
```

导出目录中按集合放置 JSON 文件，例如：
- `users.json`
- `orders.json`
- `notifications.json`
- `favorites.json`
- `withdrawals.json`
- `payment_logs.json`
- `system_stats.json`
- `abnormal_logs.json`
- `settlement_logs.json`

## 小程序侧变更
- 已移除运行主链路对 `wx.cloud.callFunction` 的依赖
- `utils/request.js` 统一处理 HTTP 请求和 token
- `utils/api.js` 已切换到自建后端接口
- `utils/cloudImages.js` 已改为 HTTP / 本地文件 URL 解析

## 注意事项
- 微信公众平台需要把 `https://YOUR_API_HOST` 配置为 request / upload / download 合法域名
- 历史云文件只保留引用兼容，新上传文件全部走本地服务器
- 正式上线前请轮换已经暴露过的支付和小程序敏感密钥

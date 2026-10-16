# 校园代拿小程序

微信小程序客户端及 Node.js 服务端源码。仓库跟踪文件已清理生产凭据、部署目标和个人工作区数据；Git 历史中的副本已在本地历史中清理，发布时仍需更新远端。

## 项目结构

- `pages/`、`utils/`：小程序页面和客户端逻辑
- `cloudfunctions/`：微信云函数
- `server/`：Express 服务端和数据迁移脚本

## 本地配置

克隆后先配置自己的小程序和服务端环境；仓库中的占位值不能直接连接任何生产服务。

1. 在 `project.config.json` 和 `utils/config.js` 中填写自己的小程序 AppID、API 地址和上传地址。
2. 复制 `server/.env.example` 为 `server/.env`，填写服务端环境变量。生产环境必须设置强随机 `JWT_SECRET`、数据库地址、微信 AppSecret 和支付参数。
3. 将商户证书放入 `server/certs/`，并通过环境变量配置文件路径。真实 `.env`、证书及密钥已由 `.gitignore` 排除，不要提交或打包。
4. 使用微信开发者工具导入项目，并在 `server/` 安装依赖、设置环境变量后启动服务。

```powershell
Set-Location server
npm install
npm run start
```

云函数需在微信云开发控制台配置对应的支付环境变量。不要在代码中添加密钥或生产账号信息。

## 安全提醒

- 曾公开过的密钥应立即在对应平台撤销并轮换；从文件和历史中删除不能使已泄露凭据自动失效。
- 本地 Git 历史已重写以移除敏感副本；发布前需协调并强制更新 GitHub 远端，旧克隆和分叉仍可能保留原历史。
- Git 忽略规则不会自动取消已跟踪文件的版本控制；提交前应检查暂存内容和历史。
- `.vs/`、`.vscode/`、`.workbuddy-ai/`、`project.private.config.json` 和 `server.zip` 属于本地缓存、私有配置或敏感归档，不应提交。

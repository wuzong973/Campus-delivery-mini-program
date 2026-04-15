# 校园代拿微信小程序

## 当前版本

当前工程已经切换为纯云开发数据链路：

- 前端通过云对象 `campusService` 调用后端
- 订单、用户、钱包、管理台统一走云数据库真实数据
- 本地演示模式已从运行主链路中移除
- 登录采用 `wx.login` 微信一键注册/登录

## 你的云开发配置

- AppID：已写入项目配置
- 云环境 ID：`cloud1-1grbxinfd03d7059`
- 平台抽成：`1%`

## 需要部署的云端能力

请在微信开发者工具中分别“安装依赖”并部署：

- `cloudfunctions/campusService`
- `cloudfunctions/login`
- `cloudfunctions/order`
- `cloudfunctions/finance`
- `cloudfunctions/admin`
- `cloudfunctions/payUnifiedOrder`

其中：

- `campusService` 是前端直接调用的云对象
- `login / order / finance / admin` 是云对象转调的业务云函数
- `payUnifiedOrder` 是支付下单云函数

## 需要创建的云数据库集合

首次运行时大部分集合会在写入时自动创建，建议提前在云开发控制台建立这些集合并配置权限：

- `users`
- `orders`
- `notifications`
- `favorites`
- `withdrawals`
- `payment_logs`
- `system_stats`
- `abnormal_logs`

推荐权限：

- `users / orders / notifications / favorites / withdrawals / payment_logs / abnormal_logs`
  仅创建者可读写，管理员通过云函数/云对象管理
- `system_stats`
  仅管理员和云函数可写

## 已接入能力

- 微信一键注册/登录
- 资料完善后才可发单和接单
- 发布订单写入云数据库
- 接单大厅从云数据库读取真实订单
- 订单状态通过云对象同步到云数据库
- 接单、取消、拍照送达、完成结算、评价
- 我的订单、任务大厅、订单详情全部读取真实数据
- 后台管理台读取真实用户、订单、提现、异常记录
- 联系客服入口
- 钱包、提现、平台抽成统计

## 支付说明

当前项目已接入真实支付调用链：

1. 发布订单
2. 创建支付日志
3. 调用 `payUnifiedOrder`
4. 前端 `wx.requestPayment`
5. 支付成功后回写订单支付状态

当前仍有两个上线前必须补齐的关键项：

1. 商户 API 私钥
   你目前提供的是商户公钥和序列号，正式微信支付签名链路还需要商户 API 私钥文件。
2. 正式支付回调域名 / 最终异步通知方案
   现在代码里已经做了客户端支付成功后的状态回写，但如果你要做到更严格的“服务端异步回调确认”，还需要补正式回调配置。

## 上线前建议

- 不要把支付密钥、上传密钥、CLI 密钥继续硬编码在仓库里
- 建议把商户敏感信息迁移到云函数私密配置或独立未提交的配置文件
- 部署后先在测试环境完整联调：登录、发单、支付、接单、送达、完成、提现、管理审核


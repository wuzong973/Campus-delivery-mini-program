const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const { Schema } = mongoose;

function createSchema(definition, options = {}) {
  return new Schema(
    Object.assign(
      {
        _id: {
          type: String,
          default: () => uuidv4(),
        },
      },
      definition,
    ),
    Object.assign(
      {
        versionKey: false,
        strict: false,
      },
      options,
    ),
  );
}

const User = mongoose.model(
  "User",
  createSchema(
    {
      openid: { type: String, index: true, unique: true },
      nickname: String,
      avatarUrl: String,
      phone: String,
      commonAddress: String,
      avatarTheme: String,
      slogan: String,
      role: String,
      completedJobs: Number,
      averageScore: Number,
      walletBalance: Number,
      totalIncome: Number,
      totalWithdrawn: Number,
      totalSpending: Number,
      lastLoginCode: String,
      loginCount: Number,
      createdAt: Number,
      updatedAt: Number,
      lastLoginAt: Number,
    },
    { collection: "users" },
  ),
);

const Order = mongoose.model(
  "Order",
  createSchema(
    {
      orderNo: { type: String, index: true },
      outTradeNo: { type: String, index: true },
      publisherOpenId: { type: String, index: true },
      runnerOpenId: { type: String, index: true },
      payStatus: { type: String, index: true },
      status: { type: String, index: true },
      rewardAmount: Number,
      platformFee: Number,
      runnerIncome: Number,
      createdAt: Number,
      updatedAt: Number,
      acceptedAt: Number,
      deliveredAt: Number,
      completedAt: Number,
      cancelledAt: Number,
      paidAt: Number,
    },
    { collection: "orders" },
  ),
);

const Notification = mongoose.model(
  "Notification",
  createSchema(
    {
      userOpenId: { type: String, index: true },
      title: String,
      content: String,
      type: String,
      orderId: String,
      read: Boolean,
      createdAt: Number,
    },
    { collection: "notifications" },
  ),
);

const Favorite = mongoose.model(
  "Favorite",
  createSchema(
    {
      userOpenId: { type: String, index: true },
      orderId: { type: String, index: true },
      createdAt: Number,
    },
    { collection: "favorites" },
  ),
);

const Withdrawal = mongoose.model(
  "Withdrawal",
  createSchema(
    {
      userOpenId: { type: String, index: true },
      amount: Number,
      status: String,
      remark: String,
      createdAt: Number,
      updatedAt: Number,
      processedAt: Number,
      processedByOpenId: String,
    },
    { collection: "withdrawals" },
  ),
);

const PaymentLog = mongoose.model(
  "PaymentLog",
  createSchema(
    {
      orderId: { type: String, index: true },
      outTradeNo: { type: String, index: true },
      transactionId: String,
      type: String,
      status: String,
      createdAt: Number,
      updatedAt: Number,
    },
    { collection: "payment_logs" },
  ),
);

const SystemStat = mongoose.model(
  "SystemStat",
  createSchema(
    {
      totalVolume: Number,
      platformIncome: Number,
      totalRunnerIncome: Number,
      updatedAt: Number,
    },
    { collection: "system_stats" },
  ),
);

const AbnormalLog = mongoose.model(
  "AbnormalLog",
  createSchema(
    {
      userOpenId: { type: String, index: true },
      type: String,
      reason: String,
      createdAt: Number,
    },
    { collection: "abnormal_logs" },
  ),
);

const SettlementLog = mongoose.model(
  "SettlementLog",
  createSchema(
    {
      orderId: { type: String, index: true },
      runnerOpenId: String,
      publisherOpenId: String,
      rewardAmount: Number,
      platformFee: Number,
      runnerIncome: Number,
      status: String,
      createdAt: Number,
      updatedAt: Number,
    },
    { collection: "settlement_logs" },
  ),
);

const Chat = mongoose.model(
  "Chat",
  createSchema(
    {
      sessionId: { type: String, index: true },
      orderId: { type: String, index: true },
      fromUserOpenId: { type: String, index: true },
      toUserOpenId: { type: String, index: true },
      fromUserId: { type: String, index: true },
      toUserId: { type: String, index: true },
      type: String,
      content: String,
      imageUrl: String,
      readByOpenIds: [String],
      createdAt: Number,
    },
    { collection: "chats" },
  ),
);

const ChatSession = mongoose.model(
  "ChatSession",
  createSchema(
    {
      orderId: { type: String, index: true },
      participantOpenIds: [{ type: String, index: true }],
      participantUserIds: [{ type: String, index: true }],
      lastMessageText: String,
      lastMessageType: String,
      lastMessageAt: { type: Number, index: true },
      lastSenderOpenId: String,
      unreadCounts: Object,
      createdAt: Number,
      updatedAt: Number,
    },
    { collection: "chat_sessions" },
  ),
);

module.exports = {
  User,
  Order,
  Notification,
  Favorite,
  Withdrawal,
  PaymentLog,
  SystemStat,
  AbnormalLog,
  SettlementLog,
  Chat,
  ChatSession,
};

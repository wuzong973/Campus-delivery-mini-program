const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const env = require("../src/config/env");
const models = require("../src/models");

const COLLECTION_MODEL_MAP = {
  users: models.User,
  orders: models.Order,
  notifications: models.Notification,
  favorites: models.Favorite,
  withdrawals: models.Withdrawal,
  payment_logs: models.PaymentLog,
  system_stats: models.SystemStat,
  abnormal_logs: models.AbnormalLog,
  settlement_logs: models.SettlementLog,
};

async function bootstrap() {
  const exportDir = path.resolve(process.argv[2] || "server/data/cloud-export");
  if (!fs.existsSync(exportDir)) {
    throw new Error(`导出目录不存在: ${exportDir}`);
  }

  await mongoose.connect(env.mongoUri);

  for (const [collectionName, Model] of Object.entries(COLLECTION_MODEL_MAP)) {
    const filePath = path.join(exportDir, `${collectionName}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`[skip] ${collectionName} -> ${filePath}`);
      continue;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const docs = JSON.parse(raw);
    if (!Array.isArray(docs) || !docs.length) {
      console.log(`[empty] ${collectionName}`);
      continue;
    }

    await Model.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { _id: String(doc._id) },
          update: {
            $set: {
              ...doc,
              _id: String(doc._id),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    console.log(`[imported] ${collectionName}: ${docs.length}`);
  }

  await mongoose.disconnect();
}

bootstrap().catch((error) => {
  console.error("[import-cloud-export] failed", error);
  process.exit(1);
});

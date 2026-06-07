const mongoose = require("mongoose");
const env = require("./env");

async function connectMongo() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  return mongoose.connection;
}

module.exports = {
  connectMongo,
};

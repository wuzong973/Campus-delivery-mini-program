const env = require("./config/env");
const { connectMongo } = require("./config/mongo");
const app = require("./app");

async function bootstrap() {
  await connectMongo();
  app.listen(env.port, () => {
    console.log(`[server] listening on ${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] bootstrap failed", error);
  process.exit(1);
});

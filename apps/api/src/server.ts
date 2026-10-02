import { installProxyFromEnv } from "@prepkit/core";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { MemoryStore } from "./store/memory-store.js";
import { MongoStore } from "./store/mongo-store.js";
import type { Store } from "./store/types.js";

installProxyFromEnv();

let store: Store;
if (config.mongoUri) {
  store = await MongoStore.connect(config.mongoUri);
  console.log("Connected to MongoDB");
} else {
  if (config.isProd) throw new Error("MONGODB_URI is required in production.");
  console.warn("MONGODB_URI not set — using an in-memory store (data is lost on restart).");
  store = new MemoryStore();
}

const { app, jobs } = createApp({ store });
await jobs.resumeUnfinished();
app.listen(config.port, () => console.log(`API listening on :${config.port}`));

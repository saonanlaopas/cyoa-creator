import { buildApp } from "./app.js";
import { readRuntimeConfig } from "./config.js";

const config = readRuntimeConfig();
const app = buildApp({ databasePath: config.databasePath });

await app.listen({ host: config.host, port: config.port });

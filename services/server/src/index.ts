import { createMusebookClient } from "@musebook/toolkit/musebook";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createMemoryRoutineStore, createPostgresRoutineStore } from "./routines";

const config = loadConfig();
const store = config.databaseUrl
  ? await createPostgresRoutineStore(config.databaseUrl)
  : createMemoryRoutineStore();
if (!config.workerSharedSecret) {
  console.warn("WORKER_SHARED_SECRET is not set; /internal routes will refuse every request.");
}
const app = createApp({ config, store, musebook: createMusebookClient(config.musebookOrigin) });
Bun.serve({ port: config.port, fetch: app.fetch });
console.info(`agent-kit server on :${config.port} (store ${config.databaseUrl ? "postgres" : "memory"}, openbot ${config.openbotServerUrl})`);

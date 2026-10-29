import { loadWorkerEnv } from "./env";
import { runOneTick } from "./tick";

const env = loadWorkerEnv();
console.info(`agent-kit worker sweeping ${env.serverInternalUrl} every ${env.tickMs}ms`);
for (;;) {
  const result = await runOneTick(env);
  console[result.ok ? "info" : "warn"](JSON.stringify({ type: "routine-sweep", ...result }));
  await Bun.sleep(env.tickMs);
}

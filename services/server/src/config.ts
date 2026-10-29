import { musebookOrigin } from "@musebook/toolkit/musebook";

/**
 * Everything the server reads from its environment, with the documented defaults.
 *
 * Postgres and the OpenBot server are optional: without `DATABASE_URL` routines live in
 * memory (fine for a laptop, lost on restart); without `OPENBOT_SERVER_URL` the default
 * http://localhost:8000 is used and a run that cannot reach it is recorded as failed.
 * The server never holds wallet keys and exposes no signing or payment endpoint.
 */
export type ServerConfig = {
  port: number;
  musebookOrigin: string;
  databaseUrl: string | undefined;
  openbotServerUrl: string;
  openbotServerToken: string | undefined;
  workerSharedSecret: string | undefined;
};

export const DEFAULTS = {
  PORT: 4000,
  OPENBOT_SERVER_URL: "http://localhost:8000",
} as const;

function trimmed(value: string | undefined) {
  return value?.trim() || undefined;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const rawPort = trimmed(env.PORT);
  let port: number = DEFAULTS.PORT;
  if (rawPort !== undefined) {
    if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
      throw new Error(`PORT must be a whole number from 1 to 65535 (got ${JSON.stringify(env.PORT)}).`);
    }
    port = Number(rawPort);
  }
  const databaseUrl = trimmed(env.DATABASE_URL);
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a postgres:// URL.");
  }
  const openbot = (trimmed(env.OPENBOT_SERVER_URL) ?? DEFAULTS.OPENBOT_SERVER_URL).replace(/\/+$/, "");
  const parsed = new URL(openbot);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OPENBOT_SERVER_URL must be http(s).");
  }
  return {
    port,
    musebookOrigin: musebookOrigin(env.MUSEBOOK_ORIGIN),
    databaseUrl,
    openbotServerUrl: openbot,
    openbotServerToken: trimmed(env.OPENBOT_SERVER_TOKEN),
    workerSharedSecret: trimmed(env.WORKER_SHARED_SECRET),
  };
}

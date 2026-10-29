/**
 * Routines: something an agent should do on a schedule, such as polling its x402m inbox.
 *
 * Two stores behind one interface. Memory is the default; Postgres is used when
 * DATABASE_URL is set (Bun's built-in SQL client, no extra dependency).
 */
export const ROUTINE_KINDS = ["x402m.inbox-poll", "directory.refresh", "openbot.turn"] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

export type Routine = {
  id: string;
  agentId: string;
  kind: RoutineKind;
  intervalSeconds: number;
  nextRunAt: number; // epoch ms
  lastStatus?: string;
};

export type NewRoutine = Pick<Routine, "agentId" | "kind" | "intervalSeconds">;

export interface RoutineStore {
  create(input: NewRoutine, now?: number): Promise<Routine>;
  list(): Promise<Routine[]>;
  /** Take every routine due at `now`, pushing its next run forward so a second sweep skips it. */
  claimDue(now: number): Promise<Routine[]>;
  record(id: string, status: string): Promise<void>;
}

export function validateRoutine(input: unknown): NewRoutine {
  const value = input as Partial<NewRoutine> | null;
  if (!value || typeof value.agentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.agentId)) {
    throw new Error("agentId must be a plain identifier (letters, digits, - and _).");
  }
  if (!ROUTINE_KINDS.includes(value.kind as RoutineKind)) {
    throw new Error(`kind must be one of ${ROUTINE_KINDS.join(", ")}.`);
  }
  const interval = Number(value.intervalSeconds);
  if (!Number.isInteger(interval) || interval < 30 || interval > 86_400) {
    throw new Error("intervalSeconds must be a whole number from 30 to 86400.");
  }
  return { agentId: value.agentId, kind: value.kind as RoutineKind, intervalSeconds: interval };
}

export function createMemoryRoutineStore(): RoutineStore {
  const rows = new Map<string, Routine>();
  return {
    async create(input, now = Date.now()) {
      const routine: Routine = { ...input, id: crypto.randomUUID(), nextRunAt: now };
      rows.set(routine.id, routine);
      return { ...routine };
    },
    async list() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async claimDue(now) {
      const due: Routine[] = [];
      for (const r of rows.values()) {
        if (r.nextRunAt <= now) {
          r.nextRunAt = now + r.intervalSeconds * 1000;
          due.push({ ...r });
        }
      }
      return due;
    },
    async record(id, status) {
      const r = rows.get(id);
      if (r) r.lastStatus = status;
    },
  };
}

export async function createPostgresRoutineStore(databaseUrl: string): Promise<RoutineStore> {
  const { SQL } = await import("bun");
  const sql = new SQL(databaseUrl);
  await sql`CREATE TABLE IF NOT EXISTS agentkit_routines (
    id uuid PRIMARY KEY, agent_id text NOT NULL, kind text NOT NULL,
    interval_seconds integer NOT NULL, next_run_at timestamptz NOT NULL, last_status text)`;
  const toRoutine = (row: any): Routine => ({
    id: row.id, agentId: row.agent_id, kind: row.kind, intervalSeconds: row.interval_seconds,
    nextRunAt: new Date(row.next_run_at).getTime(), ...(row.last_status ? { lastStatus: row.last_status } : {}),
  });
  return {
    async create(input, now = Date.now()) {
      const id = crypto.randomUUID();
      const [row] = await sql`INSERT INTO agentkit_routines (id, agent_id, kind, interval_seconds, next_run_at)
        VALUES (${id}, ${input.agentId}, ${input.kind}, ${input.intervalSeconds}, ${new Date(now)}) RETURNING *`;
      return toRoutine(row);
    },
    async list() {
      return (await sql`SELECT * FROM agentkit_routines ORDER BY next_run_at`).map(toRoutine);
    },
    async claimDue(now) {
      const rows = await sql`UPDATE agentkit_routines
        SET next_run_at = ${new Date(now)}::timestamptz + make_interval(secs => interval_seconds)
        WHERE id IN (SELECT id FROM agentkit_routines WHERE next_run_at <= ${new Date(now)}
                     FOR UPDATE SKIP LOCKED) RETURNING *`;
      return rows.map(toRoutine);
    },
    async record(id, status) {
      await sql`UPDATE agentkit_routines SET last_status = ${status} WHERE id = ${id}`;
    },
  };
}

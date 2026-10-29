import { describe, expect, it } from "vitest";
import {
  assertTrust,
  meetsTrust,
  requiredTrust,
  trustRank,
  TRUST_LEVELS,
} from "../src/trust";

describe("trust ladder", () => {
  it("orders the ladder observer → sovereign", () => {
    expect([...TRUST_LEVELS]).toEqual([
      "observer",
      "dry-run",
      "delegated",
      "autonomous",
      "sovereign",
    ]);
    expect(trustRank("sovereign")).toBeGreaterThan(trustRank("observer"));
  });

  it("meetsTrust is monotonic", () => {
    expect(meetsTrust("delegated", "observer")).toBe(true);
    expect(meetsTrust("observer", "delegated")).toBe(false);
    expect(meetsTrust("autonomous", "autonomous")).toBe(true);
  });

  it("gates actions by required level", () => {
    expect(requiredTrust("resolve")).toBe("observer");
    expect(requiredTrust("execute-treasury")).toBe("autonomous");
    expect(() => assertTrust("observer", "pay")).toThrow(/requires trust/);
    expect(() => assertTrust("delegated", "pay")).not.toThrow();
    expect(() => assertTrust("sovereign", "execute-treasury")).not.toThrow();
  });
});

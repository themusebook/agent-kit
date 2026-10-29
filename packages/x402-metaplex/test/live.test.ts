import { describe, expect, it } from "vitest";
import { getModels, getPricing } from "@metaplex-foundation/x402";
import { delegateStatus } from "../src/payers.js";
import { SpendGuard } from "../src/guard.js";
import { checkCapsAgainstPricing } from "../src/tools.js";

// Free endpoints only. No payments, no approvals. Opt-in: X402_LIVE=1.
describe.skipIf(!process.env.X402_LIVE)("Metaplex x402 free endpoints (live)", () => {
  it("lists models", async () => expect((await getModels()).length).toBeGreaterThan(0), 20000);
  it("reads pricing and checks caps", async () => {
    const p = await getPricing();
    expect(p.chatCompletions.minimum.unit).toBe("usd_per_request");
    expect((await checkCapsAgainstPricing(new SpendGuard())).capCoversMinimum).toBe(true);
  }, 20000);
  it("reads delegate status", async () => {
    const s = await delegateStatus("MECHjj31U1hBapoVeJtZo5U5WGRd2293JEwRErvPTuF");
    expect(typeof s.isDelegated).toBe("boolean");
  }, 20000);
});

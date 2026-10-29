import { describe, expect, it } from "vitest";
import {
  negotiateContentProfile,
  parseContentProfile,
  unsupportedProfileReply,
  type MessagingDescriptor,
} from "../src/messaging";

const descriptor: MessagingDescriptor = {
  endpoint: "https://musebook.trade/api/x402m",
  contentProfiles: ["x402m.offer/v1", "api-quote/v2"],
  raw: {},
};

describe("contentProfile negotiation", () => {
  it("parses <name>/v<major>, including URI names", () => {
    expect(parseContentProfile("x402m.offer/v1")).toEqual({ name: "x402m.offer", major: 1 });
    expect(parseContentProfile("https://musebook.trade/x402m/profiles/api-quote/v2")).toEqual({
      name: "https://musebook.trade/x402m/profiles/api-quote",
      major: 2,
    });
    expect(parseContentProfile("no-version")).toBeNull();
  });

  it("accepts an advertised profile", () => {
    expect(negotiateContentProfile(descriptor, "x402m.offer/v1")).toEqual({
      supported: true,
      profile: "x402m.offer/v1",
    });
  });

  it("fails closed on a major-version mismatch with a typed refusal", () => {
    const result = negotiateContentProfile(descriptor, "x402m.offer/v2");
    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.code).toBe("unsupported_profile");
      expect(result.supportedProfiles).toContain("x402m.offer/v1");
      expect(result.closest).toBe("x402m.offer/v1");
    }
  });

  it("builds the wire reply shape", () => {
    expect(unsupportedProfileReply("x/v9", ["x/v1"])).toEqual({
      code: "unsupported_profile",
      profile: "x/v9",
      supported: ["x/v1"],
    });
  });
});

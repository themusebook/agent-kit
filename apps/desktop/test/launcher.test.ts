import { describe, expect, it } from "vitest";
import { STORAGE_KEY, normalizeDashboardUrl, savedUrl } from "../src/launcher";

describe("normalizeDashboardUrl", () => {
  it("adds https to a bare host", () => expect(normalizeDashboardUrl("agents.example.com")).toEqual({ url: "https://agents.example.com/" }));
  it("keeps https and drops the hash", () => expect(normalizeDashboardUrl(" https://a.io/x#y ")).toEqual({ url: "https://a.io/x" }));
  it("allows http on localhost", () => expect(normalizeDashboardUrl("http://localhost:5173")).toEqual({ url: "http://localhost:5173/" }));
  it("refuses http elsewhere", () => expect(normalizeDashboardUrl("http://a.io")).toHaveProperty("error"));
  it("refuses credentials in the URL", () => expect(normalizeDashboardUrl("https://u:p@a.io")).toHaveProperty("error"));
  it("refuses other schemes", () => expect(normalizeDashboardUrl("file:///etc/passwd")).toHaveProperty("error"));
  it("refuses empty input", () => expect(normalizeDashboardUrl("  ")).toHaveProperty("error"));
});

describe("savedUrl", () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === STORAGE_KEY ? v : null), setItem() {} });
  it("returns a valid saved URL", () => expect(savedUrl(store("https://a.io"))).toBe("https://a.io/"));
  it("ignores a bad saved URL", () => expect(savedUrl(store("http://evil.io"))).toBeNull());
  it("handles nothing saved", () => expect(savedUrl(store(null))).toBeNull());
});

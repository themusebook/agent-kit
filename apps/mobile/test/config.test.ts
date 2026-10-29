import { describe, expect, it } from "vitest";
import { normalizeDashboardUrl, rpcUrl, serverBase } from "../src/config";

describe("dashboard URL", () => {
  it("adds https and keeps only the origin", () => expect(normalizeDashboardUrl("agents.example.com/x?y")).toEqual({ origin: "https://agents.example.com" }));
  it("allows the emulator host over http", () => expect(normalizeDashboardUrl("http://10.0.2.2:5173")).toEqual({ origin: "http://10.0.2.2:5173" }));
  it("refuses http elsewhere", () => expect(normalizeDashboardUrl("http://a.io")).toHaveProperty("error"));
  it("refuses credentials", () => expect(normalizeDashboardUrl("https://u:p@a.io")).toHaveProperty("error"));
  it("builds proxy paths", () => {
    expect(serverBase("https://a.io")).toBe("https://a.io/server");
    expect(rpcUrl("https://a.io")).toBe("https://a.io/rpc");
  });
});

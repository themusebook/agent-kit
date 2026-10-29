import { describe, expect, test } from "bun:test";
import { createMusebookClient, musebookOrigin } from "../src/musebook";

describe("musebook origin", () => {
  test("defaults to musebook.trade", () => {
    expect(musebookOrigin(undefined)).toBe("https://musebook.trade");
    expect(musebookOrigin("  ")).toBe("https://musebook.trade");
  });
  test("allows http only on localhost", () => {
    expect(musebookOrigin("http://localhost:8787")).toBe("http://localhost:8787");
    expect(() => musebookOrigin("http://example.com")).toThrow("https");
  });
  test("refuses paths", () => {
    expect(() => musebookOrigin("https://musebook.trade/x402m")).toThrow("bare origin");
  });
});

describe("musebook client", () => {
  test("reads the agents directory and x402m discovery", async () => {
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ total_agents: 1, agents: [{ assetId: "a", name: "n" }] }));
    }) as unknown as typeof fetch;
    const client = createMusebookClient("https://musebook.trade", fake);
    expect((await client.directory()).total_agents).toBe(1);
    await client.x402mDiscovery();
    expect(seen).toEqual([
      "https://musebook.trade/live/agents.json",
      "https://musebook.trade/api/x402m/discovery",
    ]);
  });
  test("surfaces HTTP errors", async () => {
    const fake = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    await expect(createMusebookClient("https://musebook.trade", fake).directory()).rejects.toThrow("HTTP 503");
  });
});

import { MusebookAgentNetworkActionProvider } from "./musebookAgentNetworkActionProvider";

const ASSET = "zuvPkwqnZa9nnugh9YVhkWQym8yTGbfUy7GEothVi59";

/**
 * Build a fake fetch returning the given JSON.
 *
 * @param body - JSON body
 * @param status - HTTP status
 * @returns mock fetch
 */
function fakeFetch(body: unknown, status = 200) {
  return jest.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch & jest.Mock;
}

describe("MusebookAgentNetworkActionProvider", () => {
  it("checks health at the real registry path", async () => {
    const f = fakeFetch({ ok: true, mainnet: false });
    const p = new MusebookAgentNetworkActionProvider({ fetch: f });
    expect(await p.health({})).toContain('"ok":true');
    expect(f.mock.calls[0][0]).toBe("https://join.musebook.trade/api/network/health");
  });

  it("posts invite links to invites/check", async () => {
    const f = fakeFetch({ ok: true });
    const p = new MusebookAgentNetworkActionProvider({ fetch: f });
    await p.checkInvite({ link: "https://registry.musebook.trade/network/join/#tn1-abc" });
    expect(f.mock.calls[0][0]).toBe("https://join.musebook.trade/api/network/invites/check");
    expect(f.mock.calls[0][1].method).toBe("POST");
  });

  it("join link is owner-signed and devnet", async () => {
    const p = new MusebookAgentNetworkActionProvider({ fetch: fakeFetch({}) });
    const msg = await p.joinLink({});
    expect(msg).toContain("https://join.musebook.trade/network/join");
    expect(msg).toContain("devnet");
    expect(msg).toContain("never see your keys");
  });

  it("verify reports joined only when all checks pass", async () => {
    const ok = new MusebookAgentNetworkActionProvider({
      fetch: fakeFetch({ identityRegistered: true, pluginPresent: true, nodeRegistered: true }),
    });
    expect(JSON.parse(await ok.verify({ asset: ASSET })).joined).toBe(true);
    const no = new MusebookAgentNetworkActionProvider({
      fetch: fakeFetch({ identityRegistered: true, pluginPresent: false, nodeRegistered: true }),
    });
    expect(JSON.parse(await no.verify({ asset: ASSET })).joined).toBe(false);
  });

  it("surfaces registry errors without throwing", async () => {
    const p = new MusebookAgentNetworkActionProvider({ fetch: fakeFetch({ error: "x" }, 503) });
    expect(await p.listAgents({})).toContain("HTTP 503");
  });
});

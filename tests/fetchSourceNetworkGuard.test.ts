import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

async function fetchSourceReal() {
  return (await import("../src/agent/fetchSource")).fetchSourceReal;
}

describe("fetch_source network guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    lookupMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("blocks DNS names that resolve to private IPs before fetch", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await (await fetchSourceReal())("https://private.example/");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("blocked host (SSRF)");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pins public DNS answers through the fetch dispatcher", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    type FetchInit = RequestInit & { dispatcher?: unknown };
    const fetch = vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0], _init?: FetchInit) => new Response("<title>ok</title>", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const result = await (await fetchSourceReal())("https://public.example/");

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    const init = fetch.mock.calls[0][1];
    expect(init).toMatchObject({ redirect: "manual" });
    expect(init).toHaveProperty("dispatcher");
  });

  it("blocks redirect targets that become private or non-https", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } })));

    const privateResult = await (await fetchSourceReal())("https://public.example/");
    expect(privateResult.ok).toBe(false);
    if (!privateResult.ok) expect(privateResult.error).toBe("blocked redirect");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://example.com/" } })));
    const protocolResult = await (await fetchSourceReal())("https://public.example/");
    expect(protocolResult.ok).toBe(false);
    if (!protocolResult.ok) expect(protocolResult.error).toBe("blocked redirect");
  });

  it("applies the total timeout to DNS validation", async () => {
    vi.useFakeTimers();
    lookupMock.mockReturnValue(new Promise(() => undefined));

    const pending = (await fetchSourceReal())("https://slow.example/");
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("blocked host (SSRF)");
  });
});

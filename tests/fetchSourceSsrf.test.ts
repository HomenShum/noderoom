/**
 * Scenario: adversarial. A prompt-injected agent tries to make `fetch_source` hit internal
 * targets (loopback, RFC1918, cloud metadata) via SSRF bypass vectors. Every vector must be
 * rejected BEFORE any network call. These cases are deterministic (the guard blocks on the
 * host/IP form without DNS), so the test is hermetic.
 */
import { describe, it, expect } from "vitest";
import { fetchSourceReal } from "../src/nodeagent/skills/search/fetchSource";

const BLOCKED_HOST = [
  "https://127.0.0.1/",
  "https://2130706433/", // numeric IPv4 -> 127.0.0.1 via URL canonicalization
  "https://0x7f.1/", // hex IPv4 -> 127.0.0.1 via URL canonicalization
  "https://0177.0.0.1/", // octal IPv4 -> 127.0.0.1 via URL canonicalization
  "https://10.0.0.5/",
  "https://169.254.169.254/latest/meta-data/", // AWS metadata (IP form)
  "https://[::1]/",
  "https://[::]/",
  "https://[fe90::1]/", // fe80::/10 link-local, not just the fe80: prefix
  "https://[ff02::1]/", // IPv6 multicast
  "https://[2001:db8::1]/", // documentation/reserved
  "https://[64:ff9b::c000:201]/", // NAT64 translation prefix
  "https://[64:ff9b:1::1]/", // local-use NAT64 prefix
  "https://[2002:c000:0201::]/", // 6to4 transition prefix
  "https://[2001::1]/", // Teredo transition prefix
  "https://[::ffff:127.0.0.1]/", // IPv4-mapped IPv6 — the P0 bypass
  "https://[::7f00:1]/", // IPv4-compatible hex loopback
  "https://[::ffff:169.254.169.254]/", // IPv4-mapped IPv6 metadata — the P0 bypass
  "https://metadata.google.internal/computeMetadata/v1/", // GCP metadata by hostname — the P0 bypass
  "https://localhost/",
  "https://192.168.1.1/",
  "https://172.16.0.1/",
  "https://100.64.0.1/", // CGNAT
];

describe("fetch_source SSRF guard (adversarial)", () => {
  it.each(BLOCKED_HOST)("blocks %s before any network call", async (url) => {
    const r = await fetchSourceReal(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/blocked host|blocked protocol|invalid/);
  });

  it("blocks non-https protocols", async () => {
    const r = await fetchSourceReal("http://example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("blocked protocol");
  });

  it("rejects a malformed url", async () => {
    const r = await fetchSourceReal("not a url");
    expect(r.ok).toBe(false);
  });
});

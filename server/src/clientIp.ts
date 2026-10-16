// The learner's IP address, for per-IP rate limits (Better Auth). Behind Cloudflare,
// X-Real-IP (set by Railway's proxy) is a Cloudflare edge, and cf-connecting-ip names
// the learner. But anyone can reach Railway directly and send their own
// cf-connecting-ip, so it counts only when the request really came from Cloudflare.

import { BlockList } from "node:net";

// https://www.cloudflare.com/ips-v4 and /ips-v6, as of 2026-10-12. They change rarely; check now and then.
const CLOUDFLARE_V4 = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"];
const CLOUDFLARE_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

const cloudflare = new BlockList();
const addSubnet = (cidr: string, type: "ipv4" | "ipv6") => {
  const [net, bits] = cidr.split("/");
  if (net === undefined || bits === undefined) throw new Error(`not a CIDR range: ${cidr}`);
  cloudflare.addSubnet(net, Number(bits), type);
};
for (const r of CLOUDFLARE_V4) addSubnet(r, "ipv4");
for (const r of CLOUDFLARE_V6) addSubnet(r, "ipv6");

export const fromCloudflare = (ip: string) => cloudflare.check(ip, ip.includes(":") ? "ipv6" : "ipv4");

/** The header Better Auth reads: set here from `headers` (CLIENT_IP_HEADERS), never by the client. */
export const CLIENT_IP_HEADER = "x-perennial-client-ip";

/** The first IP the configured headers give; cf-connecting-ip only when X-Real-IP is Cloudflare's, else X-Real-IP. */
export function clientIp(h: Headers, headers: string[]): string | null {
  for (const name of headers) {
    if (name === "cf-connecting-ip") {
      const peer = h.get("x-real-ip")?.trim();
      if (!peer) continue;
      // Cloudflare always sends cf-connecting-ip; without it, the edge's own IP (one shared bucket).
      return fromCloudflare(peer) ? (h.get(name)?.trim() || peer) : peer;
    }
    // The first value: Railway's edge overwrites X-Forwarded-For, so it can't be prepended to.
    const v = h.get(name)?.split(",")[0]?.trim();
    if (v) return v;
  }
  return null;
}

/** The request with only our own client-IP header (a client cannot send one of its own). */
export function withClientIp(req: Request, headers: string[]): Request {
  const h = new Headers(req.headers);
  // Always set, "" when unknown (Better Auth skips what isn't a valid IP): Bun's
  // new Request(req, { headers }) keeps the old headers when the new ones are empty.
  h.set(CLIENT_IP_HEADER, clientIp(req.headers, headers) ?? "");
  return new Request(req, { headers: h });
}

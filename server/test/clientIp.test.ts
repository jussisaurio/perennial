import { describe, expect, test } from "bun:test";
import { CLIENT_IP_HEADER, clientIp, fromCloudflare, withClientIp } from "../src/clientIp";

const behindCloudflare = ["cf-connecting-ip"];
const h = (o: Record<string, string>) => new Headers(o);

describe("client IP for rate limits (#101)", () => {
  test("through Cloudflare: the learner's IP from cf-connecting-ip", () => {
    expect(clientIp(h({ "x-real-ip": "172.70.1.2", "cf-connecting-ip": "203.0.113.7" }), behindCloudflare)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "2606:4700::1", "cf-connecting-ip": "2001:db8::7" }), behindCloudflare)).toBe("2001:db8::7");
  });

  test("straight to Railway with a made-up cf-connecting-ip: the real peer, not the claim", () => {
    for (let i = 0; i < 3; i++) expect(clientIp(h({ "x-real-ip": "198.51.100.9", "cf-connecting-ip": `10.0.0.${i}` }), behindCloudflare)).toBe("198.51.100.9");
  });

  test("Cloudflare's ranges, IPv4 and IPv6", () => {
    expect(fromCloudflare("104.16.0.1")).toBe(true);
    expect(fromCloudflare("2a06:98c0::1")).toBe(true);
    expect(fromCloudflare("8.8.8.8")).toBe(false);
    expect(fromCloudflare("2001:4860::1")).toBe(false);
  });

  test("other proxies: the first configured header that has a value", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.9" }), ["x-real-ip", "x-forwarded-for"])).toBe("198.51.100.9");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" }), ["x-real-ip", "x-forwarded-for"])).toBe("203.0.113.1");
    expect(clientIp(h({}), ["x-real-ip"])).toBeNull();
  });

  test("a client cannot send the header Better Auth reads", () => {
    const req = new Request("https://perennial.example/api/auth/get-session", { headers: { [CLIENT_IP_HEADER]: "1.1.1.1", "x-real-ip": "198.51.100.9", "cf-connecting-ip": "10.0.0.1" } });
    expect(withClientIp(req, behindCloudflare).headers.get(CLIENT_IP_HEADER)).toBe("198.51.100.9");
    const none = new Request("https://perennial.example/", { headers: { [CLIENT_IP_HEADER]: "1.1.1.1" } });
    expect(withClientIp(none, ["x-real-ip"]).headers.get(CLIENT_IP_HEADER)).toBe(""); // unknown: not the client's claim
  });
});

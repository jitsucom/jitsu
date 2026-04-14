import { isPrivateIP } from "../src/functions/lib";
import * as dns from "node:dns";
import { describe, it, expect } from "vitest";

describe("isPrivateIP", () => {
  // Private IPv4 ranges
  it.each([
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.0.1", true],
    ["192.168.1.100", true],
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["0.0.0.0", true],
    ["169.254.1.1", true],
  ])("IPv4 private: %s → %s", (addr, expected) => {
    expect(isPrivateIP(addr)).toBe(expected);
  });

  // Public IPv4 ranges
  it.each([
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["172.15.0.1", false],
    ["172.32.0.1", false],
    ["192.167.1.1", false],
    ["192.169.1.1", false],
    ["93.184.216.34", false],
    ["104.16.0.1", false],
    ["142.250.80.46", false],
  ])("IPv4 public: %s → %s", (addr, expected) => {
    expect(isPrivateIP(addr)).toBe(expected);
  });

  // Private IPv6
  it.each([
    ["::1", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
  ])("IPv6 private: %s → %s", (addr, expected) => {
    expect(isPrivateIP(addr)).toBe(expected);
  });

  // Public IPv6
  it.each([
    ["2001:4860:4860::8888", false],
    ["2606:4700:4700::1111", false],
  ])("IPv6 public: %s → %s", (addr, expected) => {
    expect(isPrivateIP(addr)).toBe(expected);
  });

  // IPv4-mapped IPv6 (CVE-2024-29415 bypass vector)
  it.each([
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:192.168.1.1", true],
    ["::ffff:8.8.8.8", false],
    ["::ffff:1.1.1.1", false],
  ])("IPv4-mapped IPv6: %s → %s", (addr, expected) => {
    expect(isPrivateIP(addr)).toBe(expected);
  });

  // Invalid/malformed inputs should not be classified as private
  it.each([
    ["not-an-ip", false],
    ["", false],
    ["127.1", false],
    ["012.1.2.3", false],
  ])("invalid input: %s → %s", (addr, expected) => {
    expect(isPrivateIP(addr)).toBe(expected);
  });

  // Verify real public domains resolve to non-private IPs
  it.each(["google.com", "cloudflare.com", "github.com"])("public domain %s resolves to public IP", async domain => {
    const addresses = await dns.promises.lookup(domain, { all: true });
    for (const addr of addresses) {
      expect(isPrivateIP(addr.address)).toBe(false);
    }
  });
});

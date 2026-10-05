import { isBlockedAddress, isPublicAddress } from "../src/functions/lib/public-address";
import { isPrivateIP } from "../src/functions/lib";
import { describe, it, expect } from "vitest";

describe("isPublicAddress / isBlockedAddress", () => {
  // Public IPv4: must stay reachable. Includes neighbours of every blocked range (off-by-one in a prefix).
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "104.16.0.1",
    "142.250.80.46",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "11.0.0.1",
    "9.255.255.255",
    "126.255.255.255",
    "128.0.0.1",
    "169.253.255.255",
    "169.255.0.1",
    "223.255.255.255",
  ])("public IPv4: %s", addr => {
    expect(isPublicAddress(addr)).toBe(true);
    expect(isBlockedAddress(addr)).toBe(false);
  });

  // Regression: a BlockList entry for ::ffff:0:0/96 matches every IPv4 address and blocks the internet.
  it("does not block ordinary public IPv4 addresses", () => {
    for (const addr of [
      "8.8.8.8",
      "1.1.1.1",
      "172.32.0.1",
      "100.128.0.1",
      "198.20.0.1",
      "52.95.110.1",
      "35.225.194.146",
    ]) {
      expect(isPublicAddress(addr)).toBe(true);
    }
  });

  // The neighbours of those three ranges stay public: the blocks are exactly /24s.
  it.each(["192.31.195.255", "192.31.197.0", "192.52.192.255", "192.52.194.0", "192.175.47.255", "192.175.49.0"])(
    "public IPv4 next to a blocked /24: %s",
    addr => {
      expect(isPublicAddress(addr)).toBe(true);
    }
  );

  // Special-purpose IPv4: each range's first, last and a middle address.
  it.each([
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.0",
    "10.1.2.3",
    "10.255.255.255",
    "100.64.0.0",
    "100.64.0.1",
    "100.100.100.200",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.0.0",
    "169.254.169.254",
    "169.254.255.255",
    "172.16.0.0",
    "172.20.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    // AS112-v4, AMT and Direct Delegation AS112: listed in the IANA special-purpose registry (globally reachable
    // anycast services, blocked anyway because the module promises every special-purpose range).
    "192.31.196.0",
    "192.31.196.1",
    "192.31.196.255",
    "192.52.193.0",
    "192.52.193.77",
    "192.52.193.255",
    "192.175.48.0",
    "192.175.48.42",
    "192.175.48.255",
    "192.88.99.1",
    "192.168.0.1",
    "192.168.255.255",
    "198.18.0.0",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.254",
    "255.255.255.255",
  ])("blocked IPv4: %s", addr => {
    expect(isBlockedAddress(addr)).toBe(true);
    expect(isPublicAddress(addr)).toBe(false);
  });

  // The /48 is exact: its neighbours stay public.
  it.each(["2620:4f:7fff:ffff::1", "2620:4f:8001::1", "2620:4e:8000::1", "2620:50:8000::1"])(
    "public IPv6 next to the blocked AS112 /48: %s",
    addr => {
      expect(isPublicAddress(addr)).toBe(true);
    }
  );

  // Public IPv6 (global unicast outside the reserved sub-ranges).
  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "2620:fe::fe", "2a00:1450:4001:81b::200e", "2400:cb00::1"])(
    "public IPv6: %s",
    addr => {
      expect(isPublicAddress(addr)).toBe(true);
    }
  );

  // Blocked IPv6: unspecified, loopback, IPv4-compatible, NAT64, ULA, link-local, site-local, multicast, tunnels, docs.
  it.each([
    "::",
    "::1",
    "::7f00:1",
    "::a00:1",
    "64:ff9b::7f00:1",
    "64:ff9b::808:808",
    "64:ff9b:1::1",
    "100::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "ff00::",
    "2001::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:db8::1",
    "2002:7f00:1::1",
    "2002:a00:1::1",
    "3fff::1",
    // Segment Routing (SRv6) SIDs, 5f00::/16: outside 2000::/3, so the global-unicast allow-list already excludes it.
    "5f00::",
    "5f00::1",
    "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    // Direct Delegation AS112 Service (IANA: globally reachable anycast, blocked because it is a special-purpose range).
    "2620:4f:8000::",
    "2620:4f:8000::1",
    "2620:4f:8000:ffff:ffff:ffff:ffff:ffff",
    "1::1",
    "4000::1",
  ])("blocked IPv6: %s", addr => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  // IPv4-mapped IPv6 is judged by its IPv4 address, in dotted and hex form (the URL parser emits hex).
  it.each([
    ["::ffff:127.0.0.1", true],
    ["::ffff:7f00:1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:a00:1", true],
    ["::ffff:192.168.1.1", true],
    ["::ffff:c0a8:101", true],
    ["::ffff:169.254.169.254", true],
    ["::ffff:a9fe:a9fe", true],
    ["::ffff:100.64.0.1", true],
    ["::ffff:6440:1", true],
    ["::ffff:8.8.8.8", false],
    ["::ffff:808:808", false],
    ["::ffff:1.1.1.1", false],
    ["::FFFF:7F00:1", true],
  ])("IPv4-mapped IPv6: %s blocked=%s", (addr, blocked) => {
    expect(isBlockedAddress(addr)).toBe(blocked);
  });

  // Anything that is not a canonical IP literal fails closed.
  it.each([
    "",
    " ",
    "not-an-ip",
    "localhost",
    "example.com",
    "127.1",
    "2130706433",
    "0x7f.0.0.1",
    "0177.0.0.1",
    "012.1.2.3",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "8.8.8.8/32",
    "8.8.8.8:80",
    "::ffff:",
    "fe80::1%eth0",
    "2606:4700:4700::1111%eth0",
  ])("fails closed for %j", addr => {
    expect(isBlockedAddress(addr)).toBe(true);
    expect(isPublicAddress(addr)).toBe(false);
  });

  // The forms a URL host takes.
  it("accepts bracketed IPv6 and ignores case and surrounding whitespace", () => {
    expect(isPublicAddress("[2606:4700:4700::1111]")).toBe(true);
    expect(isBlockedAddress("[::1]")).toBe(true);
    expect(isBlockedAddress("[::ffff:7f00:1]")).toBe(true);
    expect(isBlockedAddress("FE80::1")).toBe(true);
    expect(isPublicAddress("  8.8.8.8  ")).toBe(true);
    expect(isBlockedAddress(" 10.0.0.1 ")).toBe(true);
  });

  // The URL parser already normalises numeric host forms to dotted IPv4, so callers pass its hostname.
  it.each([
    "http://2130706433/",
    "http://0x7f.1/",
    "http://017700000001/",
    "http://127.1/",
    "http://[::ffff:127.0.0.1]/",
  ])("URL host normalisation never yields a public address: %s", url => {
    expect(isBlockedAddress(new URL(url).hostname)).toBe(true);
  });

  // Compatibility: everything the existing isPrivateIP blocks stays blocked, so adopting this cannot reopen a hole.
  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.1.100",
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "169.254.1.1",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
  ])("still blocks what isPrivateIP blocks: %s", addr => {
    expect(isPrivateIP(addr)).toBe(true);
    expect(isBlockedAddress(addr)).toBe(true);
  });

  // Documented gaps in isPrivateIP that this module closes.
  it.each([
    "100.64.0.1",
    "100.100.100.200",
    "::",
    "::ffff:7f00:1",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
    "febf::1",
    "fec0::1",
    "198.18.0.1",
    "192.0.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ])("closes the isPrivateIP gap: %s", addr => {
    expect(isPrivateIP(addr)).toBe(false);
    expect(isBlockedAddress(addr)).toBe(true);
  });
});

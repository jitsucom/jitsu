import * as net from "node:net";

/**
 * Address classification for outbound requests to user-supplied URLs.
 *
 * Fails closed: anything that is not a canonical IP literal, and every address in a special-purpose
 * range, is blocked. IPv4 uses a deny-list of special-purpose ranges. IPv6 uses an allow-list: only
 * global unicast (2000::/3) outside its reserved sub-ranges is public, so unlisted ranges stay blocked.
 *
 * Do not add `::ffff:0:0/96` to a BlockList: node matches every IPv4 address against it, which would block
 * the whole IPv4 internet. IPv4-mapped IPv6 is normalised to IPv4 before checking instead.
 *
 * This only classifies an address. A request must still validate every address the hostname resolves to,
 * check IP-literal hosts directly (a literal never reaches a custom `lookup`), connect to the validated
 * address, and refuse redirects.
 */

const blockedV4 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (also the range Tailscale uses)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

const globalUnicastV6 = new net.BlockList();
globalUnicastV6.addSubnet("2000::", 3, "ipv6");

const blockedV6 = new net.BlockList();
for (const [network, prefix] of [
  ["2001::", 23], // IETF protocol assignments: Teredo, benchmarking, ORCHID
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: embeds an IPv4 address
  ["3fff::", 20], // documentation
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

/** `::ffff:a.b.c.d` and `::ffff:xxxx:xxxx` (the form the URL parser produces) to dotted IPv4, else undefined. */
function mappedIPv4(addr: string): string | undefined {
  const dotted = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    return dotted[1];
  }
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return undefined;
}

/** True when the address must not be contacted: not an IP literal, or not a public unicast address. */
export function isBlockedAddress(address: string): boolean {
  // Accept the forms a URL host takes: bracketed IPv6, and a zone id (never public).
  let addr = address.trim().toLowerCase();
  if (addr.startsWith("[") && addr.endsWith("]")) {
    addr = addr.slice(1, -1);
  }
  if (addr.includes("%")) {
    return true;
  }
  const family = net.isIP(addr);
  if (family === 4) {
    return blockedV4.check(addr, "ipv4");
  }
  if (family === 6) {
    const mapped = mappedIPv4(addr);
    if (mapped) {
      return blockedV4.check(mapped, "ipv4");
    }
    return !globalUnicastV6.check(addr, "ipv6") || blockedV6.check(addr, "ipv6");
  }
  return true;
}

/** True only for an IP literal that is a public unicast address. */
export function isPublicAddress(address: string): boolean {
  return !isBlockedAddress(address);
}

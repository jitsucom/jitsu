import { z } from "zod";

/**
 * An IPv4 or IPv6 address, accepted as zod 3's `z.string().ip()` accepted it.
 *
 * zod 4's `z.ipv6()` rejects a link-local address with a zone id (`fe80::1%eth0`), which zod 3 took. A Reverse ETL row
 * mapped from a text column holding one would fail validation, and the runner aborts on the first failing row. The zone
 * alternative below is copied from zod 3's ipv6 regex.
 */
export function ipAddress() {
  return z.union([z.ipv4(), z.ipv6(), z.string().regex(linkLocalWithZone, "Invalid IP address")]);
}

const linkLocalWithZone = /^fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}$/;

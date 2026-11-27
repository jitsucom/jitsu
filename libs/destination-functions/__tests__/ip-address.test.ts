import { describe, expect, it } from "vitest";
import { ipAddress } from "../src/ip-address";

// Expected values were recorded from zod 3.25.76 z.string().ip(); ipAddress() must answer the same.
const zod3: [string, boolean][] = [
  ["1.2.3.4", true],
  ["256.1.1.1", false],
  ["1.2.3.4/24", false],
  ["::1", true],
  ["2001:db8::1", true],
  ["::ffff:1.2.3.4", true],
  ["fe80::1", true],
  ["fe80::1%eth0", true],
  ["fe80::1%1", true],
  ["fe80::1%", false],
  ["fe80::1%a b", false],
  ["fe80::1%eth0%1", false],
  ["fe80::1%eth0.1", false],
  ["fe80::1%en-0", false],
  ["fe80::1%_", false],
  ["1.2.3.4%eth0", false],
  ["%eth0", false],
  ["::%x", false],
  ["", false],
];

describe("ipAddress keeps zod 3 ip() behaviour", () => {
  it.each(zod3)("%j", (input, accepted) => {
    expect(ipAddress().safeParse(input).success).toBe(accepted);
  });
});

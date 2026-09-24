import { expect, it } from "vitest";
import { warehouseErrorMessage } from "../../lib/server/warehouse-errors";

it("preserves warehouse diagnostics without a stack", () => {
  expect(warehouseErrorMessage(new Error('column "missing" does not exist at position 8'), {}, "Preview failed.")).toBe(
    'Preview failed. column "missing" does not exist at position 8'
  );
});
it("redacts raw, encoded and JSON-escaped configured secrets", () => {
  const password = 'pass/@"word';
  const message = `${password} ${encodeURIComponent(password)} ${JSON.stringify(password).slice(1, -1)}`;
  expect(warehouseErrorMessage(new Error(message), { password }, "Preview failed.")).toBe(
    "Preview failed. [redacted] [redacted] [redacted]"
  );
});
it("redacts service-account keys, connection URLs and authorization headers", () => {
  const config = { keyFile: JSON.stringify({ private_key: "private-test-key", client_email: "service@test" }) };
  const message = "private-test-key postgres://user:pass@db/test Authorization: Bearer abc.def permission denied";
  expect(warehouseErrorMessage(new Error(message), config, "Preview failed.")).toBe(
    "Preview failed. [redacted] postgres://[redacted]@db/test Authorization: Bearer [redacted] permission denied"
  );
});
it("uses a fallback for unstructured errors and bounds long diagnostics", () => {
  expect(warehouseErrorMessage({}, {}, "Preview failed.")).toBe("Preview failed.");
  expect(warehouseErrorMessage(new Error("x".repeat(5000)), {}, "Error:")).toHaveLength(4007);
});

import { describe, expect, it } from "vitest";
import { exportEventId } from "../src/lib/kafka-events-store";

describe("export eventId content hash", () => {
  it("matches the pinned cross-language vector (same recipe as Go eventslog.ExportEventId)", () => {
    // sha256("a|1000|{}") truncated to 16 bytes hex — pinned in
    // bulker/eventslog/kafka_events_log_test.go too; a change on either side
    // breaks billing dedup consistency
    expect(exportEventId("a", 1000, "{}")).toBe("dde5351e0557fb1f4dd77478100c7a88");
  });

  it("is deterministic and content-sensitive", () => {
    const a = exportEventId("con1", 1700000000500, `{"k":"v"}`);
    expect(exportEventId("con1", 1700000000500, `{"k":"v"}`)).toBe(a);
    expect(exportEventId("con1", 1700000000500, `{"k":"w"}`)).not.toBe(a);
    expect(exportEventId("con2", 1700000000500, `{"k":"v"}`)).not.toBe(a);
    expect(exportEventId("con1", 1700000000501, `{"k":"v"}`)).not.toBe(a);
    expect(a).toHaveLength(32);
  });
});

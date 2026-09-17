import { describe, expect, it } from "vitest";
import { nextRecoveryCheck, RecoverySchedule } from "./recovery-schedule";

describe("provider recovery backoff", () => {
  it("waits 30 minutes, increases by 1.3, and caps intervals at an hour", () => {
    let now = Date.parse("2026-09-16T00:00:00.000Z");
    let previous: RecoverySchedule | undefined;
    for (const minutes of [30, 39, 50.7, 60, 60]) {
      const next = RecoverySchedule.parse(nextRecoveryCheck("run", "revision", previous, now));
      expect(Date.parse(next.nextCheckAt) - now).toBe(minutes * 60_000);
      expect(next.deadline).toBe("2026-09-17T00:00:00.000Z");
      now = Date.parse(next.nextCheckAt);
      previous = next;
    }
  });
  it("schedules a final check at the deadline and never extends the 24-hour window", () => {
    const first = nextRecoveryCheck("run", "revision", undefined, 0)!;
    const deadline = Date.parse(first.deadline);
    const last = nextRecoveryCheck("run", "revision", first, deadline - 1000)!;
    expect(last.nextCheckAt).toBe(first.deadline);
    expect(nextRecoveryCheck("run", "revision", last, deadline)).toBeUndefined();
    expect(nextRecoveryCheck("run", "revision", last, deadline + 1)).toBeUndefined();
  });
});

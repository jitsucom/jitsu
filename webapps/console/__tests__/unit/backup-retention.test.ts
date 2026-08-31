import { describe, expect, it } from "vitest";
import {
  BackupRetentionChange,
  defaultBackupRetentionHours,
  DEFAULT_BACKUP_RETENTION_HOURS,
  describeBackupRetention,
  formatBackupRetention,
  FREE_BACKUP_RETENTION_CAP_DAYS,
  isBackupEnabled,
  getBackupRetentionCapDays,
  PAID_BACKUP_RETENTION_CAP_DAYS,
  parseExplicitBackupRetentionHours,
  resolveBackupMode,
  validateBackupRetentionChange,
} from "../../lib/shared/data-retention";

describe("resolveBackupMode / describeBackupRetention", () => {
  it("falls through explicit -> nobackup -> default", () => {
    expect(describeBackupRetention([], undefined)).toEqual({
      retentionHours: DEFAULT_BACKUP_RETENTION_HOURS,
      source: "default",
      locked: false,
    });
    expect(describeBackupRetention(["nobackup"], undefined)).toEqual({
      retentionHours: 0,
      source: "nobackup",
      locked: true,
    });
    // an explicit row wins over the flag, so the flag governs nothing and the
    // workspace must not be reported (or gated) as "backups turned off"
    expect(describeBackupRetention(["nobackup"], { backupRetentionHours: 720 })).toEqual({
      retentionHours: 720,
      source: "explicit",
      locked: false,
    });
    expect(describeBackupRetention(null, { backupRetentionHours: "168" })).toEqual({
      retentionHours: 168,
      source: "explicit",
      locked: false,
    });
  });

  it("treats malformed explicit values as unset — never as 0", () => {
    for (const raw of [true, " ", "", "abc", -1, [0], {}, "1e3", "9".repeat(400), NaN, Infinity]) {
      expect(parseExplicitBackupRetentionHours({ backupRetentionHours: raw })).toBeUndefined();
      expect(resolveBackupMode([], { backupRetentionHours: raw })).toEqual({
        migrated: true,
        retentionHours: DEFAULT_BACKUP_RETENTION_HOURS,
      });
    }
    expect(parseExplicitBackupRetentionHours({ backupRetentionHours: 0 })).toBe(0);
    expect(parseExplicitBackupRetentionHours({ backupRetentionHours: "0" })).toBe(0);
    expect(parseExplicitBackupRetentionHours(null)).toBeUndefined();
  });
});

describe("defaultBackupRetentionHours (plan-aware default)", () => {
  it("caps the fleet default at what the plan allows", () => {
    expect(defaultBackupRetentionHours(FREE_BACKUP_RETENTION_CAP_DAYS)).toBe(7 * 24);
    expect(defaultBackupRetentionHours(PAID_BACKUP_RETENTION_CAP_DAYS)).toBe(DEFAULT_BACKUP_RETENTION_HOURS);
    expect(defaultBackupRetentionHours(30)).toBe(30 * 24);
    // an enterprise cap above the fleet default doesn't raise the default
    expect(defaultBackupRetentionHours(365)).toBe(DEFAULT_BACKUP_RETENTION_HOURS);
    expect(defaultBackupRetentionHours(0)).toBe(0);
  });

  it("falls back to the fleet default when the cap is unknown or malformed", () => {
    expect(defaultBackupRetentionHours(undefined)).toBe(DEFAULT_BACKUP_RETENTION_HOURS);
    expect(defaultBackupRetentionHours(NaN)).toBe(DEFAULT_BACKUP_RETENTION_HOURS);
    expect(defaultBackupRetentionHours(-1)).toBe(DEFAULT_BACKUP_RETENTION_HOURS);
  });

  it("free workspaces default to 7 days, and backups stay enabled", () => {
    expect(describeBackupRetention([], undefined, FREE_BACKUP_RETENTION_CAP_DAYS)).toEqual({
      retentionHours: 7 * 24,
      source: "default",
      locked: false,
    });
    expect(isBackupEnabled([], undefined, FREE_BACKUP_RETENTION_CAP_DAYS)).toBe(true);
  });

  it("an explicit row and the nobackup flag still win over the plan default", () => {
    expect(resolveBackupMode([], { backupRetentionHours: 2160 }, FREE_BACKUP_RETENTION_CAP_DAYS)).toEqual({
      migrated: true,
      retentionHours: 2160,
    });
    expect(describeBackupRetention(["nobackup"], undefined, PAID_BACKUP_RETENTION_CAP_DAYS)).toEqual({
      retentionHours: 0,
      source: "nobackup",
      locked: true,
    });
    // the plan cap never turns the lock on or off
    expect(
      describeBackupRetention(["nobackup"], { backupRetentionHours: 168 }, FREE_BACKUP_RETENTION_CAP_DAYS)
    ).toEqual({ retentionHours: 168, source: "explicit", locked: false });
  });
});

describe("getBackupRetentionCapDays", () => {
  it("defaults by plan when the plan carries no explicit cap", () => {
    expect(getBackupRetentionCapDays({ planId: "free" })).toBe(FREE_BACKUP_RETENTION_CAP_DAYS);
    expect(getBackupRetentionCapDays(undefined)).toBe(FREE_BACKUP_RETENTION_CAP_DAYS);
    expect(getBackupRetentionCapDays({ planId: "business" })).toBe(PAID_BACKUP_RETENTION_CAP_DAYS);
    expect(getBackupRetentionCapDays({ planId: "$admin" })).toBe(PAID_BACKUP_RETENTION_CAP_DAYS);
  });

  it("honours an explicit plan cap, including one above the presets", () => {
    expect(getBackupRetentionCapDays({ planId: "free", backupRetentionMaxDays: 30 })).toBe(30);
    expect(getBackupRetentionCapDays({ planId: "enterprise", backupRetentionMaxDays: 365 })).toBe(365);
  });

  it("never lets an explicit cap drop below the free cap (nobackup is the lock)", () => {
    expect(getBackupRetentionCapDays({ planId: "business", backupRetentionMaxDays: 0 })).toBe(
      FREE_BACKUP_RETENTION_CAP_DAYS
    );
    expect(getBackupRetentionCapDays({ planId: "business", backupRetentionMaxDays: -5 })).toBe(
      FREE_BACKUP_RETENTION_CAP_DAYS
    );
    expect(getBackupRetentionCapDays({ planId: "business", backupRetentionMaxDays: NaN })).toBe(
      PAID_BACKUP_RETENTION_CAP_DAYS
    );
  });
});

describe("validateBackupRetentionChange", () => {
  const paid = { capDays: PAID_BACKUP_RETENTION_CAP_DAYS, locked: false };
  const free = { capDays: FREE_BACKUP_RETENTION_CAP_DAYS, locked: false };

  it("accepts presets within the cap", () => {
    expect(validateBackupRetentionChange({ retentionDays: 7 }, free)).toBeUndefined();
    expect(validateBackupRetentionChange({ retentionDays: 90 }, paid)).toBeUndefined();
    expect(validateBackupRetentionChange({ retentionDays: 0, acknowledgeDataLoss: true }, free)).toBeUndefined();
  });

  it("rejects non-preset values", () => {
    expect(validateBackupRetentionChange({ retentionDays: 14 }, paid)?.code).toBe("not_preset");
    expect(validateBackupRetentionChange({ retentionDays: 365 }, { capDays: 365, locked: false })?.code).toBe(
      "not_preset"
    );
  });

  it("enforces the plan cap", () => {
    expect(validateBackupRetentionChange({ retentionDays: 30 }, free)?.code).toBe("plan_cap");
    expect(validateBackupRetentionChange({ retentionDays: 90 }, free)?.code).toBe("plan_cap");
    expect(validateBackupRetentionChange({ retentionDays: 7 }, { capDays: 0, locked: false })?.code).toBe("plan_cap");
  });

  it("requires the data-loss acknowledgement for 0 days", () => {
    expect(validateBackupRetentionChange({ retentionDays: 0 }, free)?.code).toBe("ack_required");
    expect(validateBackupRetentionChange({ retentionDays: 0, acknowledgeDataLoss: false }, free)?.code).toBe(
      "ack_required"
    );
  });

  it("refuses any change on a nobackup-locked workspace, whatever the plan", () => {
    expect(validateBackupRetentionChange({ retentionDays: 7 }, { ...paid, locked: true })?.code).toBe("locked");
    expect(
      validateBackupRetentionChange({ retentionDays: 0, acknowledgeDataLoss: true }, { ...paid, locked: true })?.code
    ).toBe("locked");
  });

  it("body schema rejects fractional and negative days", () => {
    expect(BackupRetentionChange.safeParse({ retentionDays: 1.5 }).success).toBe(false);
    expect(BackupRetentionChange.safeParse({ retentionDays: -1 }).success).toBe(false);
    expect(BackupRetentionChange.safeParse({ retentionDays: "7" }).success).toBe(false);
    expect(BackupRetentionChange.safeParse({ retentionDays: 7 }).success).toBe(true);
  });
});

describe("formatBackupRetention", () => {
  it("formats days, singular day, and odd hours", () => {
    expect(formatBackupRetention(0)).toBe("No backups");
    expect(formatBackupRetention(24)).toBe("1 day");
    expect(formatBackupRetention(2160)).toBe("90 days");
    expect(formatBackupRetention(36)).toBe("36 hours");
  });
});

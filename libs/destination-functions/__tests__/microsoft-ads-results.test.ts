import { expect, it, vi } from "vitest";
import {
  microsoftReportRange,
  parseMicrosoftReport,
  pollMicrosoftReport,
  readMicrosoftAudience,
  submitMicrosoftReport,
} from "../src/functions/microsoft-ads/results";
import {
  publicReportUrl,
  unzipMicrosoftReport,
  downloadMicrosoftReport,
} from "../src/functions/microsoft-ads/report-download";
import type { MicrosoftReader } from "../src/functions/microsoft-ads/discovery";

const header = "AccountId,Goal,GoalType,CurrencyCode,AllConversionsQualified,AllRevenue\n";
it("aggregates exact goal/account totals by currency, retaining fractional conversions and zero", () => {
  const csv = Buffer.from(
    header +
      '456,"A, B",OfflineConversion,USD,0.5,"1,200.25"\n456,"A, B",OfflineConversion,USD,1.5,0\n456,"A, B",OfflineConversion,EUR,0,0\n456,Other,OfflineConversion,USD,100,100\n456,"A, B",Event,USD,200,200\n'
  );
  expect(parseMicrosoftReport(csv, "456", "A, B")).toEqual([
    { currency: "USD", conversions: 2, revenue: 1200.25 },
    { currency: "EUR", conversions: 0, revenue: 0 },
  ]);
});
it.each([
  "999,Goal,OfflineConversion,USD,1,2",
  "456,Goal,OfflineConversion,USD,--,0",
  "456,Goal,OfflineConversion,USD,,0",
  "456,Goal,OfflineConversion,USD,1,2,3",
])("rejects wrong scope or unavailable/malformed metrics: %s", row => {
  expect(() => parseMicrosoftReport(Buffer.from(header + row), "456", "Goal")).toThrow("unsupported conversion report");
});
it("distinguishes no matching goal rows from a measured zero", () => {
  expect(parseMicrosoftReport(Buffer.from(header), "456", "Goal")).toEqual([]);
  expect(() => parseMicrosoftReport(Buffer.from(""), "456", "Goal")).toThrow();
});
it("uses the previous 30 completed Pacific days across UTC midnight and DST", () => {
  expect(microsoftReportRange(new Date("2026-10-13T00:30:00Z"))).toEqual({ start: "2026-09-12", end: "2026-10-11" });
  expect(microsoftReportRange(new Date("2026-03-09T12:00:00Z"))).toEqual({ start: "2026-02-07", end: "2026-03-08" });
});
it("requests modern conversion metrics and account-scoped campaign summary", async () => {
  const read = vi.fn<MicrosoftReader>().mockResolvedValue({ ReportRequestId: "report-123" });
  expect(await submitMicrosoftReport(read, "456", { start: "2026-09-01", end: "2026-09-30" })).toBe("report-123");
  expect(read).toHaveBeenCalledWith("report", {
    ReportRequest: expect.objectContaining({
      Type: "CampaignPerformanceReportRequest",
      Aggregation: "Summary",
      Scope: { AccountIds: ["456"] },
      Columns: ["AccountId", "Goal", "GoalType", "CurrencyCode", "AllConversionsQualified", "AllRevenue"],
    }),
  });
});
it("preserves pending and no-data reports without pretending they failed or measured zero", async () => {
  const read = vi
    .fn<MicrosoftReader>()
    .mockResolvedValueOnce({ ReportRequestStatus: { Status: "Pending" } })
    .mockResolvedValueOnce({ ReportRequestStatus: { Status: "Success", ReportDownloadUrl: null } })
    .mockResolvedValueOnce({ ReportRequestStatus: { Status: "Error" } });
  expect((await pollMicrosoftReport(read, "id")).Status).toBe("Pending");
  expect((await pollMicrosoftReport(read, "id")).ReportDownloadUrl).toBeNull();
  await expect(pollMicrosoftReport(read, "id")).rejects.toThrow("could not generate");
});
it("preserves missing audience size separately from reported zero and verifies ownership", async () => {
  const read = vi.fn<MicrosoftReader>().mockResolvedValue({
    Audiences: [{ Id: "1", Name: "Customers", Type: "CustomerList", SearchSize: 0, AudienceNetworkSize: null }],
  });
  expect(await readMicrosoftAudience(read, "1")).toMatchObject({ searchSize: "0", audienceNetworkSize: null });
  await expect(readMicrosoftAudience(read, "1", { marker: "managed", accountId: "456" })).rejects.toThrow(
    "does not match"
  );
  await expect(readMicrosoftAudience(read, "2")).rejects.toThrow("does not match");
});
it.each([
  "http://example.com/report",
  "https://user:pass@example.com/report",
  "https://127.0.0.1/report",
  "https://[::1]/report",
  "https://169.254.169.254/report",
  "https://example.com:444/report",
])("blocks unsafe report URLs: %s", url => {
  expect(() => publicReportUrl(url)).toThrow();
});
it("permits changing public report hosts but rejects local DNS and malformed ZIPs", async () => {
  expect(publicReportUrl("https://reports.example.com/signed?a=b").hostname).toBe("reports.example.com");
  await expect(downloadMicrosoftReport("https://localhost/private?secret=hidden")).rejects.toThrow("safety limits");
  await expect(unzipMicrosoftReport(Buffer.from("invalid"))).rejects.toThrow("safety limits");
  await expect(unzipMicrosoftReport(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow("safety limits");
});

// Minimal stored ZIP fixtures; sizes and entry names are the security-relevant fields.
function zipFixture(entries: { name: string; data: string; size?: number }[]) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = Buffer.from(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.size ?? data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(entry.size ?? data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(dir, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
it("extracts only a single bounded CSV without touching the filesystem", async () => {
  expect((await unzipMicrosoftReport(zipFixture([{ name: "report.csv", data: header }]))).toString()).toBe(header);
  for (const entries of [
    [{ name: "../escape.csv", data: header }],
    [{ name: "report.csv", data: header, size: 11 * 1024 * 1024 }],
    [
      { name: "report.csv", data: header },
      { name: "second.csv", data: header },
    ],
    [{ name: "report.exe", data: header }],
  ])
    await expect(unzipMicrosoftReport(zipFixture(entries))).rejects.toThrow("safety limits");
});

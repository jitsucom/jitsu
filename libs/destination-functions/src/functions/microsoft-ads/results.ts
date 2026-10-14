import { z } from "zod";
import { parse } from "csv-parse/sync";
import { MicrosoftReadError, microsoftRemoteId, type MicrosoftReader } from "./discovery";

export async function readMicrosoftAudience(
  read: MicrosoftReader,
  id: string,
  managed?: { marker: string; accountId: string }
) {
  const data = await read("audience", { Type: "CustomerList", AudienceIds: [id] });
  const matches = z
    .array(
      z
        .object({
          Id: microsoftRemoteId,
          Type: z.literal("CustomerList"),
          Name: z.string(),
          ParentId: microsoftRemoteId.optional(),
          Description: z.string().nullish(),
          Scope: z.string().optional(),
          MembershipDuration: z.number().optional(),
          SearchSize: z.unknown(),
          AudienceNetworkSize: z.unknown(),
        })
        .nullable()
    )
    .parse(data.Audiences)
    .filter(a => a?.Id === id);
  const audience = matches[0];
  if (
    matches.length !== 1 ||
    !audience ||
    (managed &&
      (audience.ParentId !== managed.accountId ||
        audience.Description !== managed.marker ||
        audience.Scope !== "Account" ||
        audience.MembershipDuration !== -1))
  )
    throw new MicrosoftReadError(
      "The Microsoft audience does not match the saved target. Check account access and preserved audience state."
    );
  const count = (value: unknown) => {
    const parsed = z
      .union([z.string().regex(/^\d+$/), z.number().int().nonnegative().safe().transform(String)])
      .safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  return {
    targetId: id,
    name: audience.Name,
    searchSize: count(audience.SearchSize),
    audienceNetworkSize: count(audience.AudienceNetworkSize),
  };
}

// Explicit dates in Microsoft's default reporting timezone, excluding the incomplete current day.
export function microsoftReportRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  const midnight = Date.UTC(get("year"), get("month") - 1, get("day"));
  return {
    start: new Date(midnight - 30 * 86400000).toISOString().slice(0, 10),
    end: new Date(midnight - 86400000).toISOString().slice(0, 10),
  };
}
const columns = ["AccountId", "Goal", "GoalType", "CurrencyCode", "AllConversionsQualified", "AllRevenue"];
export async function submitMicrosoftReport(
  read: MicrosoftReader,
  accountId: string,
  range: { start: string; end: string }
) {
  const date = (s: string) => {
    const [Year, Month, Day] = s.split("-").map(Number);
    return { Year, Month, Day };
  };
  const data = await read("report", {
    ReportRequest: {
      Type: "CampaignPerformanceReportRequest",
      ReportName: "Jitsu goal totals",
      Format: "Csv",
      FormatVersion: "2.0",
      Aggregation: "Summary",
      ExcludeColumnHeaders: false,
      ExcludeReportHeader: true,
      ExcludeReportFooter: true,
      ReturnOnlyCompleteData: false,
      Columns: columns,
      Scope: { AccountIds: [accountId] },
      Time: {
        CustomDateRangeStart: date(range.start),
        CustomDateRangeEnd: date(range.end),
        ReportTimeZone: "PacificTimeUSCanadaTijuana",
      },
    },
  });
  return z.string().min(1).max(40).parse(data.ReportRequestId);
}
export async function pollMicrosoftReport(read: MicrosoftReader, id: string) {
  const data = await read("poll", { ReportRequestId: id });
  const status = z
    .object({ Status: z.enum(["Pending", "Success", "Error"]), ReportDownloadUrl: z.string().nullish() })
    .parse(data.ReportRequestStatus);
  if (status.Status === "Error")
    throw new MicrosoftReadError("Microsoft could not generate the conversion report. Start a fresh report later.");
  return status;
}

/** Campaign summary avoids ConversionPerformance's Shopping exclusion. Select the exact goal and retain currency boundaries. */
export function parseMicrosoftReport(csv: Buffer, accountId: string, goal: string) {
  try {
    const rows: string[][] = parse(csv, { bom: true, skip_empty_lines: true, max_record_size: 64 * 1024 });
    if (!rows.length || rows[0].length !== columns.length || rows[0].some((c, i) => c !== columns[i]))
      throw new Error();
    const totals = new Map<string, { currency: string; conversions: number; revenue: number }>();
    const numeric = (s: string) => {
      if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) throw new Error();
      const n = Number(s.replaceAll(",", ""));
      if (!Number.isFinite(n)) throw new Error();
      return n;
    };
    for (const row of rows.slice(1)) {
      if (row[0] !== accountId) throw new Error();
      if (row[1] !== goal || row[2] !== "OfflineConversion") continue;
      const currency = z
        .string()
        .regex(/^[A-Z]{3}$/)
        .parse(row[3]);
      const total = totals.get(currency) ?? { currency, conversions: 0, revenue: 0 };
      total.conversions += numeric(row[4]);
      total.revenue += numeric(row[5]);
      if (!Number.isFinite(total.conversions) || !Number.isFinite(total.revenue)) throw new Error();
      totals.set(currency, total);
    }
    return [...totals.values()];
  } catch {
    throw new MicrosoftReadError(
      "Microsoft returned an unsupported conversion report. No totals are shown; check Microsoft Advertising reporting."
    );
  }
}

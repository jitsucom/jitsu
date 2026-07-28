/**
 * Client-side mirror of the migration analyzer contract served by ee-api
 * (jitsu-cloud-billing: lib/migration/types.ts + pages/api/migration/*).
 * JITSU-128 / JITSU-131. Keep in sync manually — the ee-api repo is separate.
 */

export type MigrationProvider = "segment" | "rudderstack" | "rudderstack-oss";

export type Verdict = "green" | "yellow" | "phone";

export type SnapshotSource = {
  externalId: string;
  name: string;
  type: string;
  writeKeys: string[];
  enabled: boolean;
};

export type SnapshotDestination = {
  externalId: string;
  name: string;
  type: string;
  enabled: boolean;
  mode: "device" | "cloud";
  config: Record<string, unknown>;
  secretsPresent: boolean;
  verdict: Verdict;
  verdictReason: string;
  jitsuEquivalent?: { kind: "destination" | "tag" | "webhook" | "function"; id: string };
};

export type SnapshotUsage = {
  source: "api" | "invoice" | "manual";
  monthlyEvents?: number;
  mtus?: number;
  period?: string;
  billedAmountCents?: number;
};

export type SnapshotSavings = {
  currentCostCents?: number;
  jitsuCostCents?: number;
  savingsCents?: number;
  suppressed: boolean;
  basis?: string;
};

export type MigrationSnapshot = {
  provider: MigrationProvider;
  fetchedAt: string;
  workspace: { externalId: string; name: string };
  sources: SnapshotSource[];
  destinations: SnapshotDestination[];
  warehouses: SnapshotDestination[];
  connections: { sourceExternalId: string; destinationExternalId: string }[];
  trackingPlans: { externalId: string; name: string; rulesAvailable: boolean; eventCount?: number }[];
  transformations: { externalId: string; name: string; language: string; code?: string }[];
  usage?: SnapshotUsage;
  savings?: SnapshotSavings;
  gaps: { area: string; reason: string }[];
  progress: Record<string, "pending" | "fetching" | "done" | "failed">;
};

export type MigrationReport = {
  id: string;
  provider: string;
  status: "fetching" | "ready" | "partial" | "failed" | string;
  error: string | null;
  monthlyEvents: number | null;
  currentCostCents: number | null;
  savingsCents: number | null;
  createdAt: string;
  snapshot: MigrationSnapshot | null;
};

export type InvoiceExtraction = {
  amountCents: number | null;
  currency: string | null;
  monthlyEvents: number | null;
  mtus: number | null;
  planName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

export type SavingsResponse = {
  currentCostCents: number | null;
  jitsuCostCents: number | null;
  savingsCents: number | null;
  suppressed: boolean;
  basis: string | null;
};

export const SUPPORTED_INVOICE_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

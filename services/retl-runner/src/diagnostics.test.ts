import { describe, expect, it } from "vitest";
import { failureDiagnostic, failureMessage, KubernetesHttpError } from "./diagnostics";
import { PersistenceError } from "./persistence/types";
import { MirrorRunError } from "./mirror";

describe("safe failure diagnostics", () => {
  it("preserves actionable mirror failure hints and counters without retaining raw causes", () => {
    const cause = new PersistenceError("Reverse ETL artifact upload failed; no delivery is authorized", {
      cause: new Error("private-token"),
    });
    const error = new MirrorRunError("snapshot", 100, 50, cause);
    expect(error.message).toContain("during snapshot (read 100 rows, saved 50)");
    expect(error.message).toContain("check storage connectivity and permissions");
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("private-token");
  });
  it.each([
    ["Model query contains duplicate primary keys", "Return one deterministic row per primary key"],
    ["Async batches require distinct member identities", "Multiple source rows identify the same audience member"],
    ["Audience is exclusively managed by a mirror sync", "This audience is reserved by another sync"],
    ["Source row failed destination validation", "Check the model output"],
    ["Reverse ETL recovery artifact is missing or corrupt; delivery blocked", "Saved sync data is missing"],
    [
      "Google replacement cutoff unavailable; no audience changes submitted",
      "No audience changes were submitted by this attempt",
    ],
    [
      "Google replacement cleanup receipt unavailable; manual reconciliation required, no automatic replay",
      "Uploaded members may already be present, but cleanup is not confirmed",
    ],
  ])("reports an actionable message for %s", (reason, hint) => {
    const error = new PersistenceError(reason, { cause: new Error("private-token") });
    expect(failureMessage(error, "task-123")).toContain(hint);
    expect(failureMessage(error, "task-123")).toContain("Run ID: task-123");
    expect(failureDiagnostic("execution", error).reason).toBe(reason);
    expect(JSON.stringify(failureDiagnostic("execution", error))).not.toContain("private-token");
  });
  it("does not disclose unknown errors, even when they contain a known reason", () => {
    const error = new Error("Async batches require distinct member identities: private@example.com");
    expect(failureMessage(error, "task-123")).toContain("Contact support or your Jitsu administrator");
    expect(failureMessage(error, "task-123")).not.toContain("private@example.com");
    expect(failureDiagnostic("execution", error).reason).toBeUndefined();
  });
  it("keeps known database codes without leaking driver messages or fields", () => {
    const cause = Object.assign(new Error("password=secret email=private@example.com"), {
      code: "42501",
      detail: "private payload",
      query: "private SQL",
    });
    expect(
      failureDiagnostic("task_start", new PersistenceError("Reverse ETL persistence transaction failed", { cause }))
    ).toEqual({
      event: "reverse_etl_failure",
      stage: "task_start",
      reason: "Reverse ETL persistence transaction failed",
      code: "42501",
    });
  });
  it("omits arbitrary messages, codes, stacks and properties", () => {
    const error = Object.assign(new Error("private token"), { code: "private code", httpStatus: "private value" });
    expect(failureDiagnostic("execution", error)).toEqual({ event: "reverse_etl_failure", stage: "execution" });
  });
  it("keeps Kubernetes HTTP status and nested TLS errors", () => {
    expect(failureDiagnostic("lease_acquire", new KubernetesHttpError(403)).httpStatus).toBe(403);
    const error = new PersistenceError("Kubernetes request failed", {
      cause: Object.assign(new Error("private hostname"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
    });
    expect(failureDiagnostic("lease_acquire", error).code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
  });
  it("bounds cyclic causes and handles non-errors", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    for (const value of [error, null, "private error"])
      expect(failureDiagnostic("startup", value)).toEqual({ event: "reverse_etl_failure", stage: "startup" });
  });
});

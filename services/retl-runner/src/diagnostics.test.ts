import { describe, expect, it } from "vitest";
import { failureDiagnostic, KubernetesHttpError } from "./diagnostics";
import { PersistenceError } from "./persistence/types";

describe("safe failure diagnostics", () => {
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

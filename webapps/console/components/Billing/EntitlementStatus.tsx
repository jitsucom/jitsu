import React from "react";

/** Unknown access is neither a plan denial nor permission to enable a feature. */
export function EntitlementStatus({ loading, retry }: { loading: boolean; retry: () => void }) {
  return (
    <div role="status" className="mb-2 text-textLight">
      {loading ? (
        "Checking access…"
      ) : (
        <>
          Could not verify access.{" "}
          <button type="button" className="underline" onClick={retry}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}

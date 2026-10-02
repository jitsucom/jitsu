import { useApi } from "./useApi";
import { useWorkspace } from "./context";

/** `true` entitled, `false` denied, `null` not determined. */
export type Entitlement = boolean | null;

export type WorkspaceEntitlementsResult = {
  loading: boolean;
  failed: boolean;
  retry: () => void;
  customDomains: Entitlement;
  identityStitching: Entitlement;
};

/**
 * EE access is independent of the browser's Firebase-backed billing UI.
 * Show upgrade messaging only for false, enable new gated actions only for
 * true, and offer loading/retry feedback for null. Existing configurations
 * remain editable. When billing is unreachable the server returns null for
 * both entitlements, never an upgrade-required verdict.
 */
export function useEntitlements(): WorkspaceEntitlementsResult {
  const workspace = useWorkspace();
  const { data, isLoading, isFetching, isError, refetch } = useApi(`/api/${workspace.id}/entitlements`);
  const retry = () => {
    void refetch();
  };
  if (isLoading || isError || !data) {
    return { loading: isLoading || isFetching, failed: isError, retry, customDomains: null, identityStitching: null };
  }
  return {
    loading: isFetching,
    failed: false,
    retry,
    customDomains: data.customDomains ?? null,
    identityStitching: data.identityStitching ?? null,
  };
}

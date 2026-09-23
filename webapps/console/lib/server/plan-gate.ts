import { NextApiRequest } from "next";
import { getLog, rpc } from "juava";
import { ApiError } from "../shared/errors";
import { parseBillingSettings, SessionUser } from "../schema";
import {
  canUseCustomDomains,
  canUseIdentityStitching,
  hasIdentityStitching,
  IDENTITY_STITCHING_FUNCTION_ID,
  WORKSPACE_DOMAINS_FEATURE,
} from "../shared/plan-features";
import { eeAuthHeadersOrServiceToken, getEeConnection, isEEAvailable, serviceTokenHeaders } from "./ee";

const log = getLog("plan-gate");

export { hasIdentityStitching, IDENTITY_STITCHING_FUNCTION_ID };

const PLAN_UNVERIFIED = "Could not verify your subscription plan. Please try again in a few minutes.";

/**
 * Plan gates for custom domains and Identity Stitching (JITSU-228), enforced in
 * ConfigObjectsService so every writer goes through them — the REST routes, the
 * MCP server, the CLI and the public configuration API alike. A UI-only gate is
 * bypassed by any API token, which is the thing this ticket exists to stop.
 *
 * Two properties worth keeping if this is edited:
 *
 * 1. The gates compare the *delta*, not the state. A workspace that already has
 *    a custom domain keeps it and can still edit the rest of its stream; only
 *    adding or changing a domain is refused. Grandfathering existing customers
 *    is therefore automatic and needs no migration — and it has to be, because
 *    the ingest layer is plan-blind (bulker resolves a Host to a stream with no
 *    entitlement check at all), so a console gate could never have revoked a
 *    live domain anyway.
 *
 * 2. Nothing calls ee-api unless the delta is non-empty. An ordinary save that
 *    touches no gated field costs no extra RPC and can never 503 because
 *    billing was briefly unreachable.
 */

/** Billing settings for a workspace, straight from ee-api. Fails closed. */
async function fetchPlan(workspaceId: string, user: SessionUser, req?: NextApiRequest) {
  try {
    const settings: any = await rpc(`${getEeConnection().host}api/billing/settings`, {
      method: "GET",
      query: { workspaceId, email: user.email },
      headers: {
        "Content-Type": "application/json",
        ...(req ? eeAuthHeadersOrServiceToken(req, user) : serviceTokenHeaders()),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!settings?.ok) {
      throw new Error(`billing/settings returned ok=false: ${settings?.error ?? "unknown error"}`);
    }
    return parseBillingSettings(settings);
  } catch (e) {
    log.atError().withCause(e).log(`Can't verify the plan of workspace ${workspaceId} for a gated feature`);
    throw new ApiError(PLAN_UNVERIFIED, { status: 503 });
  }
}

/** Domains carried by a config object, normalised. `type` is "stream" or "domain". */
export function domainsOf(type: string, config: any): string[] {
  if (!config) {
    return [];
  }
  if (type === "domain") {
    return typeof config.name === "string" && config.name.trim() ? [config.name.trim().toLowerCase()] : [];
  }
  if (type === "stream") {
    return (Array.isArray(config.domains) ? config.domains : [])
      .filter((d: unknown): d is string => typeof d === "string" && !!d.trim())
      .map((d: string) => d.trim().toLowerCase());
  }
  return [];
}

/**
 * Refuse a write that *adds* a custom domain on a plan without the entitlement.
 * `prev` is undefined on create. Domains already present are left alone, so an
 * existing configuration stays editable.
 */
export async function assertCustomDomainsAllowed(
  user: SessionUser,
  workspace: { id: string; featuresEnabled?: readonly string[] | null },
  type: string,
  next: any,
  prev?: any,
  req?: NextApiRequest
): Promise<void> {
  if (type !== "stream" && type !== "domain") {
    return;
  }
  if (!isEEAvailable()) {
    return;
  }
  const before = new Set(domainsOf(type, prev));
  const added = domainsOf(type, next).filter(d => !before.has(d));
  if (added.length === 0) {
    return;
  }
  await assertCustomDomainsEntitlement(user, workspace, req, added);
}

/**
 * Read the same feature rules used by the write gates. Unlike the browser's
 * billing provider, this uses EE availability independently of Firebase.
 * A lookup failure returns unknown instead of an upgrade-required verdict.
 */
export async function resolveEntitlements(
  user: SessionUser,
  workspace: { id: string; featuresEnabled?: readonly string[] | null },
  req?: NextApiRequest
): Promise<{ customDomains: boolean | null; identityStitching: boolean | null }> {
  if (!isEEAvailable()) {
    return { customDomains: true, identityStitching: true };
  }
  // The grant is a property of the workspace, not of its plan, so it is
  // answered without billing. assertCustomDomainsEntitlement returns on it
  // before its own lookup for the same reason — a billing outage must not
  // revoke an entitlement somebody granted by hand.
  const granted = (workspace.featuresEnabled ?? []).includes(WORKSPACE_DOMAINS_FEATURE);
  let billing: Awaited<ReturnType<typeof fetchPlan>> | undefined;
  try {
    billing = await fetchPlan(workspace.id, user, req);
  } catch (e) {
    // null is "unknown", not "denied". The caller renders neither an upgrade
    // prompt nor an entitlement; the write gate still fails closed with 503, so
    // nothing is granted by this uncertainty.
    return { customDomains: granted ? true : null, identityStitching: null };
  }
  return {
    customDomains: granted ? true : canUseCustomDomains(billing, workspace.featuresEnabled),
    identityStitching: canUseIdentityStitching(billing),
  };
}

/**
 * Does this workspace get custom domains at all? Separate from
 * assertCustomDomainsAllowed because provisioning does not only happen on a
 * config write: `GET /api/:workspaceId/domain-check` calls checkOrAddToIngress
 * directly, behind verifyAccess alone, and never reaches ConfigObjectsService.
 * Gating one and not the other leaves the side effect reachable, which is the
 * whole point of the gate.
 */
export async function assertCustomDomainsEntitlement(
  user: SessionUser,
  workspace: { id: string; featuresEnabled?: readonly string[] | null },
  req?: NextApiRequest,
  domains: string[] = []
): Promise<void> {
  if (!isEEAvailable()) {
    return;
  }
  // Checked before the billing round-trip: a workspace holding the grant needs
  // no plan lookup at all. Tests the flag directly — calling the resolver with
  // no billing would return true unconditionally, which defeats the gate.
  if ((workspace.featuresEnabled ?? []).includes(WORKSPACE_DOMAINS_FEATURE)) {
    return;
  }
  const billing = await fetchPlan(workspace.id, user, req);
  if (!canUseCustomDomains(billing, workspace.featuresEnabled)) {
    throw new ApiError(
      domains.length > 0
        ? `Custom domains are available on the Business and Enterprise plans. Upgrade your workspace to add ${domains.join(
            ", "
          )}.`
        : `Custom domains are available on the Business and Enterprise plans. Upgrade your workspace to use them.`,
      { status: 403 }
    );
  }
}

/**
 * Refuse a write that *turns on* Identity Stitching on a plan without the
 * entitlement. A connection that already has it keeps working and can still be
 * edited; only switching it on is refused.
 */
export async function assertIdentityStitchingAllowed(
  user: SessionUser,
  workspaceId: string,
  next: any,
  prev?: any,
  req?: NextApiRequest
): Promise<void> {
  if (!isEEAvailable()) {
    return;
  }
  if (!hasIdentityStitching(next) || hasIdentityStitching(prev)) {
    return;
  }
  const billing = await fetchPlan(workspaceId, user, req);
  if (!canUseIdentityStitching(billing)) {
    throw new ApiError(
      "Identity Stitching is available on the Enterprise plan. Contact sales to enable it for your workspace.",
      { status: 403 }
    );
  }
}

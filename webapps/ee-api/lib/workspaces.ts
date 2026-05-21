import { pg } from "./services";

export type WorkspaceListItem = {
  id: string;
  name: string;
  slug: string | null;
};

/** All non-deleted workspaces, ordered by name. */
export async function listWorkspaces(): Promise<WorkspaceListItem[]> {
  const result = await pg.query(
    `select id, name, slug from newjitsu."Workspace" where deleted = false order by name asc`
  );
  return result.rows;
}

export type ThrottleUpdate = {
  workspaceId: string;
  featuresEnabled: string[];
  featuresWithoutThrottle: string[];
  newFeatures: string[];
};

async function getWorkspaceFeatures(
  workspaceIdOrSlug: string
): Promise<{ workspaceId: string; featuresEnabled: string[] }> {
  const row = (
    await pg.query(`select id, "featuresEnabled" from newjitsu."Workspace" where id = $1 or slug = $1`, [
      workspaceIdOrSlug,
    ])
  )?.rows[0];
  if (!row) {
    throw new Error(`Workspace not found: ${workspaceIdOrSlug}`);
  }
  return { workspaceId: row.id, featuresEnabled: row.featuresEnabled || [] };
}

/** Current throttle percent for a workspace, derived from its `featuresEnabled`. */
export async function getWorkspaceThrottle(
  workspaceIdOrSlug: string
): Promise<{ workspaceId: string; throttle: number }> {
  const { workspaceId, featuresEnabled } = await getWorkspaceFeatures(workspaceIdOrSlug);
  const throttleFeature = featuresEnabled.find(f => f.startsWith("throttle"));
  const throttle = throttleFeature ? parseInt(throttleFeature.replace("throttle", "").replace("=", "")) : 0;
  return { workspaceId, throttle: isNaN(throttle) ? 0 : throttle };
}

/** Set (when `throttle > 0`) or clear the throttle feature flag for a workspace. */
export async function setWorkspaceThrottle(workspaceIdOrSlug: string, throttle: number): Promise<ThrottleUpdate> {
  const { workspaceId, featuresEnabled } = await getWorkspaceFeatures(workspaceIdOrSlug);
  const featuresWithoutThrottle = featuresEnabled.filter(f => !f.startsWith("throttle"));
  const newFeatures = throttle > 0 ? [...featuresWithoutThrottle, `throttle=${throttle}`] : featuresWithoutThrottle;
  await pg.query(`update newjitsu."Workspace" set "featuresEnabled" = $1 where id = $2`, [newFeatures, workspaceId]);
  return { workspaceId, featuresEnabled, featuresWithoutThrottle, newFeatures };
}

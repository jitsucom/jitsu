import { pg, prisma } from "./services";
import { getServerLog } from "./log";

const log = getServerLog("billing-hierarchy");

export type WorkspaceRef = { id: string; name: string; slug: string | null };

export type BillingGroup = {
  /** standalone — bills on its own; parent — has children; child — bills under a parent. */
  role: "standalone" | "parent" | "child";
  /** Set when role === "child". */
  parent?: WorkspaceRef;
  /**
   * Workspaces whose usage is consolidated when this workspace's billing page is
   * viewed: just itself for standalone/child, itself + all children for a parent.
   */
  memberWorkspaceIds: string[];
};

export type BillingParentLink = { child: WorkspaceRef; parent: WorkspaceRef; createdAt: string };

async function getWorkspaceRef(workspaceId: string): Promise<WorkspaceRef | undefined> {
  const row = (
    await pg.query(`select id, name, slug from newjitsu."Workspace" where id = $1 and deleted = false`, [workspaceId])
  ).rows[0];
  return row ? { id: row.id, name: row.name, slug: row.slug } : undefined;
}

/** The billing parent of a workspace, or undefined if it bills on its own. */
export async function getBillingParent(workspaceId: string): Promise<WorkspaceRef | undefined> {
  const link = await prisma.workspaceBillingParent.findUnique({ where: { workspaceId } });
  return link ? getWorkspaceRef(link.parentWorkspaceId) : undefined;
}

/** Ids of all workspaces that bill under the given workspace. */
export async function getBillingChildren(workspaceId: string): Promise<string[]> {
  const links = await prisma.workspaceBillingParent.findMany({
    where: { parentWorkspaceId: workspaceId },
    select: { workspaceId: true },
  });
  return links.map(l => l.workspaceId);
}

/** Resolve how a workspace bills and which workspaces its usage consolidates. */
export async function getBillingGroup(workspaceId: string): Promise<BillingGroup> {
  const parent = await getBillingParent(workspaceId);
  if (parent) {
    return { role: "child", parent, memberWorkspaceIds: [workspaceId] };
  }
  const children = await getBillingChildren(workspaceId);
  if (children.length > 0) {
    return { role: "parent", memberWorkspaceIds: [workspaceId, ...children] };
  }
  return { role: "standalone", memberWorkspaceIds: [workspaceId] };
}

/**
 * Link `workspaceId` to bill under `parentWorkspaceId`.
 *
 * Enforces the structural rules: no self-link, both workspaces must exist, and
 * only one level of nesting (a parent cannot itself be a child, and a workspace
 * that already has children cannot become a child). The free-plan rule is
 * checked by the caller — see `isWorkspaceOnFreePlan` in lib/stripe.ts.
 */
export async function setBillingParent(workspaceId: string, parentWorkspaceId: string): Promise<void> {
  if (workspaceId === parentWorkspaceId) {
    throw new Error("A workspace cannot be its own billing parent");
  }
  if (!(await getWorkspaceRef(workspaceId))) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }
  if (!(await getWorkspaceRef(parentWorkspaceId))) {
    throw new Error(`Parent workspace ${parentWorkspaceId} not found`);
  }
  const parentsParent = await prisma.workspaceBillingParent.findUnique({ where: { workspaceId: parentWorkspaceId } });
  if (parentsParent) {
    throw new Error(
      `Workspace ${parentWorkspaceId} already bills under ${parentsParent.parentWorkspaceId} — only one level of nesting is allowed`
    );
  }
  const childChildren = await getBillingChildren(workspaceId);
  if (childChildren.length > 0) {
    throw new Error(
      `Workspace ${workspaceId} is itself a billing parent of ${childChildren.length} workspace(s) — only one level of nesting is allowed`
    );
  }
  await prisma.workspaceBillingParent.upsert({
    where: { workspaceId },
    create: { workspaceId, parentWorkspaceId },
    update: { parentWorkspaceId },
  });
  log.atInfo().log(`Workspace ${workspaceId} now bills under ${parentWorkspaceId}`);
}

/** Remove a workspace's billing parent, so it bills on its own again. */
export async function removeBillingParent(workspaceId: string): Promise<void> {
  await prisma.workspaceBillingParent.deleteMany({ where: { workspaceId } });
  log.atInfo().log(`Workspace ${workspaceId} no longer bills under a parent`);
}

/** All billing-parent links, newest first, resolved to workspace names/slugs. */
export async function listBillingParentLinks(): Promise<BillingParentLink[]> {
  const links = await prisma.workspaceBillingParent.findMany({ orderBy: { createdAt: "desc" } });
  if (links.length === 0) {
    return [];
  }
  const ids = [...new Set(links.flatMap(l => [l.workspaceId, l.parentWorkspaceId]))];
  const rows = (await pg.query(`select id, name, slug from newjitsu."Workspace" where id = any($1)`, [ids])).rows;
  const byId = new Map<string, WorkspaceRef>(rows.map(r => [r.id, { id: r.id, name: r.name, slug: r.slug }]));
  return links.flatMap(l => {
    const child = byId.get(l.workspaceId);
    const parent = byId.get(l.parentWorkspaceId);
    return child && parent ? [{ child, parent, createdAt: l.createdAt.toISOString() }] : [];
  });
}

import type { Prisma, PrismaClient, Workspace } from "@prisma/client";
import type { NextApiRequest } from "next";
import type { SessionUser } from "../schema";
import type { ConfigApiDeleteOptions } from "../useApi";
import { getServerLog } from "./log";

type MutationBase = {
  id: string;
  workspace: Workspace;
  user: SessionUser;
  req?: NextApiRequest;
};

export type MutationContext<T = any> = MutationBase &
  (
    | { operation: "create"; next: T; previous?: never }
    | { operation: "update"; next: T; previous: T }
    | { operation: "delete"; next?: never; previous: T; options: ConfigApiDeleteOptions }
  );

export type MutationHooks<T = any, Prepared = void> = {
  /** Expensive validation and remote inspection; never runs while holding a DB lock. */
  prepare?: (ctx: MutationContext<T> & { prisma: PrismaClient }) => Promise<Prepared>;
  /** Shared advisory-lock names. The runner sorts and deduplicates them before acquisition. */
  lockKeys?: (ctx: MutationContext<T>) => string[];
  /** Final invariant checks and related writes, on the SAME transaction as persistence. No network calls. */
  beforeWrite?: (ctx: MutationContext<T> & { tx: Prisma.TransactionClient }, prepared: Prepared) => Promise<void>;
  /** Best-effort side effects. Failure is logged; it cannot roll back or fail an already committed write. */
  afterCommit?: (ctx: MutationContext<T> & { prisma: PrismaClient }) => Promise<void>;
};

/** Also used by connection writers, which must share locks with their endpoint objects. */
export async function withConfigTransaction<R>(
  prisma: PrismaClient,
  lockKeys: string[],
  write: (tx: Prisma.TransactionClient) => Promise<R>
): Promise<R> {
  return prisma.$transaction(async tx => {
    for (const key of [...new Set(lockKeys)].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
    return write(tx);
  });
}

export const modelMutationLock = (workspaceId: string) => `retl-models:${workspaceId}`;
export const domainClaimLock = "domain-claim";

export async function runConfigMutation<T, Prepared, R>(
  prisma: PrismaClient,
  hooks: MutationHooks<T, Prepared>,
  ctx: MutationContext<T>,
  write: (tx: Prisma.TransactionClient) => Promise<R>
): Promise<R> {
  const prepared = await hooks.prepare?.({ ...ctx, prisma });
  const result = await withConfigTransaction(prisma, hooks.lockKeys?.(ctx) ?? [], async tx => {
    // Without prepare(), Prepared is void. Hooks with preparation carry their own result type.
    await hooks.beforeWrite?.({ ...ctx, tx }, prepared as Prepared);
    return write(tx);
  });
  try {
    await hooks.afterCommit?.({ ...ctx, prisma });
  } catch (e) {
    getServerLog("config-object-lifecycle")
      .atWarn()
      .withCause(e)
      .log(`Post-commit hook failed for ${ctx.operation} of ${ctx.id} in workspace ${ctx.workspace.id}`);
  }
  return result;
}

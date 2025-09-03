import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";

async function suggestSlug(slug: string): Promise<string> {
  let counter = 1;
  while (true) {
    const newSlug = `${slug}${counter}`;
    const workspace = await db.prisma().workspace.findFirst({
      where: {
        slug: newSlug,
      },
    });
    if (!workspace) {
      return newSlug;
    }
    counter++;
  }
}

/**
 * Validates workspace name to prevent HTML injection and other security issues
 * Only allows alphanumeric characters, spaces, hyphens, underscores, and apostrophes
 */
export function validateWorkspaceName(name: string): { valid: boolean; reason?: string } {
  // Remove leading/trailing whitespace for validation
  const trimmedName = name.trim();

  if (trimmedName.length === 0) {
    return {
      valid: false,
      reason: "Workspace name cannot be empty",
    };
  }

  if (trimmedName.length > 100) {
    return {
      valid: false,
      reason: "Workspace name cannot exceed 100 characters",
    };
  }

  // Only allow safe characters: letters, numbers, spaces, hyphens, underscores, apostrophes
  // This alone prevents HTML injection and other security issues
  const safeNamePattern = /^[a-zA-Z0-9 \-_']+$/;

  if (!safeNamePattern.test(trimmedName)) {
    return {
      valid: false,
      reason: "Workspace name can only contain letters, numbers, spaces, hyphens, underscores, and apostrophes",
    };
  }

  return { valid: true };
}

export async function validateSlug(
  slug: string | undefined | null,
  currentWorkspaceId?: string
): Promise<{
  valid: boolean;
  reason?: string;
  suggestedSlug?: string;
}> {
  if (!slug) {
    return { valid: false, reason: "Slug is required" };
  }

  if (slug.length < 5) {
    return { valid: false, reason: "Slug must be at least 5 characters long" };
  }

  if (/[^a-z0-9-]/.test(slug)) {
    return {
      valid: false,
      reason: "Slug must only contain lowercase letters, numbers or hyphen",
    };
  }

  if ((slug.charAt(0) >= "0" && slug.charAt(0) <= "9") || slug.charAt(0) === "-") {
    return { valid: false, reason: "Slug can't start with a digit or hyphen" };
  }

  const existingWorkspace = await db.prisma().workspace.findFirst({
    where: {
      slug,
      ...(currentWorkspaceId ? { NOT: { id: currentWorkspaceId } } : {}),
    },
  });

  if (existingWorkspace) {
    const suggestedSlug = await suggestSlug(slug);
    return {
      valid: false,
      reason: `Slug "${slug}" is already taken`,
      suggestedSlug,
    };
  }

  return { valid: true };
}

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({
        name: z.string(),
        slug: z.string(),
        workspaceId: z.string().optional(), // Current workspace ID for updates
      }),
      result: z.object({
        name: z.object({
          valid: z.boolean(),
          reason: z.string().optional(),
        }),
        slug: z.object({
          valid: z.boolean(),
          reason: z.string().optional(),
          suggestedSlug: z.string().optional(),
        }),
        allValid: z.boolean(),
      }),
    },
    handle: async ({ user, query }) => {
      const { name, slug, workspaceId } = query;
      if (workspaceId) {
        await verifyAccess(user, workspaceId);
      }

      // Validate name
      const nameResult = validateWorkspaceName(name);

      // Validate slug
      const slugResult = await validateSlug(slug, workspaceId);

      return {
        name: nameResult,
        slug: slugResult,
        allValid: nameResult.valid && slugResult.valid,
      };
    },
  },
};

export default nextJsApiHandler(api);

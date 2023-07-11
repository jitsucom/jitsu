import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { WorkspaceDbModel } from "../../../prisma/schema";

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

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({ slug: z.string() }),
    },
    handle: async ({ user, query }) => {
      const { slug } = query;
      if (slug.length < 5) {
        return { valid: false, reason: "Slug must be at least 5 characters long" };
      } else if (/[^a-z0-9-]/.test(slug)) {
        return {
          valid: false,
          reason: "Slug must only contain lowercase letters, numbers or hyphen and start with a letter",
        };
      } else if ((slug.charAt(0) >= "0" && slug.charAt(0) <= "9") || slug.charAt(0) === "-") {
        return { valid: false, reason: "Slug can't start with a digit" };
      }
      const currentSlug = await db.prisma().workspace.findFirst({ where: { slug } });
      if (currentSlug) {
        const suggestedSlug = await suggestSlug(slug);
        return {
          valid: false,
          reason: `${slug} Slug already taken, try use ${suggestedSlug} instead`,
          suggestedSlug: suggestedSlug,
        };
      }
      return { valid: true };
    },
  },
  POST: {
    auth: true,
    types: {
      body: WorkspaceDbModel.omit({ id: true, deleted: true }),
    },
    handle: async ({ user, body }) => {
      const newWorkspace = await db.prisma().workspace.create({ data: body });
      await db.prisma().workspaceAccess.create({ data: { userId: user.internalId, workspaceId: newWorkspace.id } });
      return { id: newWorkspace.id };
    },
  },
};

export default nextJsApiHandler(api);

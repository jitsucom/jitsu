import { z } from "zod";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { assertModelsEnabled, modelColumns } from "../../../../lib/server/reverse-etl-models";
import { suggestWithJev } from "../../../../lib/server/jev-mapping";
import { MappingSuggestionRequest, MappingSuggestions } from "../../../../lib/reverse-mapping-suggestions";
import { ApiError } from "../../../../lib/shared/errors";
import { getServerEnv } from "../../../../lib/server/serverEnv";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    body: MappingSuggestionRequest,
    result: MappingSuggestions,
    rateLimit: { bucket: "reverse-mapping-suggestions", bearer: 5, session: 5, windowMs: 60_000 },
  })
  .handler(async ({ user, query: { workspaceId }, body, res }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const prisma = db.prisma();
    await assertModelsEnabled(prisma, workspaceId);
    const env = getServerEnv();
    if (!env.TYPESAFE_API_KEY)
      throw new ApiError(
        "Mapping suggestions are not configured. Ask your administrator to set TYPESAFE_API_KEY, or map columns manually.",
        { status: 503 }
      );
    const destination = await prisma.configurationObject.findFirst({
      where: { id: body.destinationId, workspaceId, type: "destination", deleted: false },
      select: { config: true },
    });
    const config = destination?.config as { destinationType?: string } | undefined;
    const metadata = reverseDestinationMetadata.get(config?.destinationType ?? "");
    const stream = metadata?.streams.find(s => s.id === body.stream);
    if (!metadata || !stream) throw new ApiError("Destination stream not found in this workspace", { status: 404 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", cancel);
    try {
      const { columns } = await modelColumns(prisma, workspaceId, body.modelId, controller.signal);
      return await suggestWithJev(
        stream,
        body,
        columns,
        {
          apiKey: env.TYPESAFE_API_KEY,
          model: env.TYPESAFE_MAPPING_MODEL,
          destination: { id: metadata.id, displayName: metadata.displayName },
        },
        controller.signal
      );
    } finally {
      clearTimeout(timeout);
      res.off("close", cancel);
    }
  });

export default route.toNextApiHandler();

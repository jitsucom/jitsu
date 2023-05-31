import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { getAllConfigObjectTypeNames } from "../../../lib/schema/config-objects";
import { coreDestinations } from "../../../lib/schema/destinations";
import { getAppEndpoint } from "../../../lib/domains";

const BaseLinkType = z.object({ fromId: z.string(), toId: z.string() });

export default createRoute()
  .GET({
    auth: false,
  })
  .handler(async ({ query, req }) => {
    const result: any[] = [];
    const publicEndpoints = getAppEndpoint(req);

    for (const typeName of getAllConfigObjectTypeNames()) {
      const schema: any = {
        type: typeName,
        schemaURL: `${publicEndpoints.baseUrl}/api/schema/${typeName}`,
      };
      if (typeName === "destination") {
        schema.subTypes = coreDestinations.reduce(
          (acc, dest) => ({
            ...acc,
            [dest.id]: {
              type: `${dest.id}`,
              schemaURL: `${publicEndpoints.baseUrl}/api/schema/${typeName}/${dest.id}`,
            },
          }),
          {}
        );
      }
      result.push(schema);
    }
    result.push({
      type: "link",
      schemaURL: `${publicEndpoints.baseUrl}/api/schema/link`,
      subTypes: coreDestinations.reduce(
        (acc, dest) => ({
          ...acc,
          [dest.id]: {
            type: `${dest.id}`,
            schemaURL: `${publicEndpoints.baseUrl}/api/schema/link/${dest.id}`,
          },
        }),
        {}
      ),
    });
    return { schemas: result };
  })
  .toNextApiHandler();

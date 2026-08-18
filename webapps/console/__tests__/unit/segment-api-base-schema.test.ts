import { expect, test } from "vitest";
import { SegmentCredentials } from "@jitsu/destination-functions/src/meta";
import zodToJsonSchema from "zod-to-json-schema";

test("Segment API Base is exposed as a dropdown with regional and legacy options", () => {
  const schema = zodToJsonSchema(SegmentCredentials) as {
    properties?: {
      apiBase?: {
        enum?: string[];
        default?: string;
      };
    };
  };

  expect(schema.properties?.apiBase).toMatchObject({
    enum: ["https://api.segmentapis.com/v1", "https://eu1.api.segmentapis.com/v1", "https://api.segment.io/v1"],
    default: "https://api.segmentapis.com/v1",
  });
});

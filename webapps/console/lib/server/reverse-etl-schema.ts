import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { resolveStreamEditor } from "@jitsu/destination-functions/src/reverse-etl/editor";
import { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { ApiError } from "../shared/errors";

export const ReverseSchemaOptions = ReverseSyncOptions.pick({
  mode: true,
  mapping: true,
  objectMappings: true,
  streamOptions: true,
})
  .partial()
  .extend({ destination: z.object({ protocol: z.string().optional() }).optional() });

/** Public provider metadata only; never loads destination credentials. */
export function reverseSyncSchema(
  destinationType?: string,
  streamId?: string,
  input?: z.input<typeof ReverseSchemaOptions>
) {
  if (!destinationType)
    return [...reverseDestinationMetadata].map(([id, meta]) => ({
      destinationType: id,
      name: meta.displayName,
      streams: meta.streams.map(s => ({ id: s.id, label: s.label })),
    }));
  const meta = reverseDestinationMetadata.get(destinationType);
  if (!meta) throw new ApiError("Destination does not support Reverse ETL", { status: 400 });
  const streams = streamId ? meta.streams.filter(s => s.id === streamId) : meta.streams;
  if (!streams.length) throw new ApiError("Unknown Reverse ETL stream", { status: 400 });
  const options = ReverseSchemaOptions.parse(input ?? {});
  // The editor contains callbacks for the browser. JSON serialization intentionally drops those;
  // isRequired/isHidden/configured are already evaluated for the supplied selections.
  return JSON.parse(
    JSON.stringify({
      destinationType,
      name: meta.displayName,
      streams: streams.map(stream => {
        const defaults = stream.defaults();
        const current = {
          ...defaults,
          ...options,
          streamOptions: { ...defaults.streamOptions, ...options.streamOptions },
        };
        return {
          id: stream.id,
          label: stream.label,
          defaults,
          streamOptionsSchema: zodToJsonSchema(stream.settings),
          ...resolveStreamEditor(stream, current),
        };
      }),
    })
  );
}

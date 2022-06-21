import { intType, SourceCollection, stringType } from "../../../sources/types"

export const mockJitsuAirbyteSourcesStreams: SourceCollection[] = [
  [
    {
      // displayName: 'Funnels',
      id: "funnels",
      displayName: "Stream",
      type: stringType,
      constant: "funnels",
    },
    {
      id: "funnel_id",
      displayName: "funnel_id",
      type: intType,
      constant: "integer",
    },
    {
      id: "funnel_id",
      displayName: "funnel_id",
      type: intType,
      constant: "integer",
    },
  ],
]

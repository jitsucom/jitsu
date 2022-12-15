import { allSingerTaps } from "./singer"
import { allNativeConnectors } from "./native"
import { makeSingerSource } from "./helper"
import { makeAirbyteSource } from "./airbyte.helper"
import { SourceConnector } from "../types"
import { snakeCase } from "lodash"
import { allAirbyteSources } from "./airbyte"
import { allSdkSources } from "./sdk_source"
import { makeSdkSource } from "./sdk_source.helper"

export const allSources = [
  ...allNativeConnectors,
  ...allSdkSources.map(makeSdkSource),
  ...allSingerTaps.filter(tap => !tap.hasNativeEquivalent && tap.pic && tap.stable).map(makeSingerSource),
  ...allAirbyteSources.filter(as => !as.hasNativeEquivalent).map(makeAirbyteSource),
]

export const allSourcesMap: { [sourceId: string]: SourceConnector } = allSources.reduce(
  (accumulator: { [key: string]: SourceConnector }, current: SourceConnector) => ({
    ...accumulator,
    [snakeCase(current.id)]: current,
  }),
  {}
)

export * from "./sdk_source.helper"
export * from "./airbyte.helper"

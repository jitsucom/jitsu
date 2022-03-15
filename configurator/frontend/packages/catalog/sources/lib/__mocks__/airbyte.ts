import { allMockAirbyteSources } from "../../../mockData/airbyte/sourcesLib/mockAirbyteSourcesLib"
import { allAirbyteSources } from "../airbyte"
import { makeAirbyteSource } from "../airbyte.helper"
jest.unmock("../airbyte")

/**
 * The list includes both manually mocked sources types and sources
 * types that are actually used in the project (taken from the sources
 * lib)
 */
const all = [...allMockAirbyteSources, ...allAirbyteSources].map(makeAirbyteSource)

export { all as allAirbyteSources }

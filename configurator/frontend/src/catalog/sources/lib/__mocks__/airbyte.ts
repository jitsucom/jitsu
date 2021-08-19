import { allMockAirbyteSources } from 'catalog/mockData/airbyte/sourcesLib/mockAirbyteSourcesLib';
import { allAirbyteSources } from '../airbyte';
import { makeAirbyteSource } from '../helper';
jest.unmock('../airbyte');

/**
 * The list icludes both manually mocked sources types and sources
 * types that are actually used in the project (taken from the sources
 * lib)
 */
const all = [...allMockAirbyteSources, ...allAirbyteSources].map(
  makeAirbyteSource
);

export { all as allAirbyteSources };

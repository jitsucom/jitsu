import { allSingerTaps } from './singer';
import { allNativeConnectors } from './native';
import { makeAirbyteSource, makeSingerSource } from './helper';
import { SourceConnector } from '../types';
import { snakeCase } from 'lodash';
import { allAirbyteSources } from './airbyte';

export const allSources = [
  ...allNativeConnectors,
  ...allSingerTaps
    .filter((tap) => !tap.hasNativeEquivalent && tap.pic && tap.stable)
    .map(makeSingerSource),
  ...allAirbyteSources.filter((as) => !as.hasNativeEquivalent)
    .map(makeAirbyteSource)
];

export const allSourcesMap: { [sourceId: string]: SourceConnector } =
  allSources.reduce(
    (
      accumulator: { [key: string]: SourceConnector },
      current: SourceConnector
    ) => ({
      ...accumulator,
      [snakeCase(current.id)]: current
    }),
    {}
  );

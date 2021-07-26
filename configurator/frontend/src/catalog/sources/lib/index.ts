import { allSingerTaps } from './singer';
import { allNativeConnectors } from './native';
import { makeSingerSource } from './helper';
import { SourceConnector } from '../types';
import { snakeCase } from 'lodash';

export const allSources = [
  ...allNativeConnectors,
  ...allSingerTaps
    .filter((tap) => !tap.hasNativeEquivalent && tap.pic && tap.stable)
    .map((tap) => makeSingerSource(tap))
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

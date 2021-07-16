import { flowResult } from 'mobx';
import { apiKeysStore } from './apiKeys';
import { destinationsStore } from './destinations';
import { sourcesStore } from './sources';

export const initializeAllStores = (): Promise<
  [
    PromiseSettledResult<void>,
    PromiseSettledResult<void>,
    PromiseSettledResult<void>
  ]
> => {
  return Promise.allSettled([
    flowResult(apiKeysStore.pullApiKeys(true)),
    flowResult(destinationsStore.pullDestinations(true)),
    flowResult(sourcesStore.pullSources(true))
  ]);
};

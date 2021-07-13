import { flowResult } from 'mobx';
import { destinationsStore } from './destinationsStore';
import { sourcesStore } from './sourcesStore';

export const initializeAllStores = () => {
  return Promise.allSettled([
    flowResult(destinationsStore.pullDestinations(true)),
    flowResult(sourcesStore.pullSources(true))
  ]);
};

import { initTracker } from './core';
import ga from './ga-plugin';
import segment from './segment-plugin';
import {TrackerPlugin} from './types'

export const eventN = initTracker();
const originalInit = eventN.init;
if (originalInit) {
  eventN.init = (opts) => {
    const plugins: TrackerPlugin[] = [];
    if (opts.ga_hook) {
      plugins.push(ga())
    }
    if (opts.segment_hook) {
      plugins.push(segment())
    }
    originalInit.apply(eventN, [opts])
    plugins.forEach(p => p(eventN));
  };
}

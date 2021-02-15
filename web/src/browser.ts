// @ts-ignore

import { initTracker } from './core';

const { eventsQ = ([] as any[]), o = {} } = (window as any).eventN || {};
const tracker = initTracker((window as any).eventNConfig || undefined);
(window as any).eventN = tracker;
tracker.logger.debug('handling event queue', eventsQ)
for (let i = 0; i < eventsQ.length; i += 1) {
  const [methodName, ...args] = (eventsQ[i] || []);
  const method = (tracker as any)[methodName];
  if (typeof method === 'function') {
    method.apply(tracker, args);
  }
}

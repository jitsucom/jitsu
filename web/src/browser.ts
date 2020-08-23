// @ts-ignore
import plugins from 'plugins';

import { initTracker } from './core';

const { q = ([] as any[]), o = {} } = (window as any).eventN || {};
const tracker = initTracker(o, plugins);
(window as any).eventN = tracker;
for (let i = 0; i < q.length; i += 1) {
  const [methodName, args] = (q[i] || []);
  const method = (tracker as any)[methodName];
  if (typeof method === 'function') {
    method.apply(tracker, args);
  }
}

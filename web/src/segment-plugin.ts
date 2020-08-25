import { Tracker, TrackerPlugin } from './types'
import { awaitGlobalProp } from './helpers'

export default (globalPropName: string = 'analytics'): TrackerPlugin => {
  let dropLastSegmentEvent = false;
  return (t: Tracker) => {
    awaitGlobalProp(globalPropName).then(
      (analytics: any) => {
        if (!analytics || typeof analytics.addSourceMiddleware !== 'function') {
          logger: t.logger.error('analytics.addSourceMiddleware is not a function', analytics)
          return;
        }

        analytics.addSourceMiddleware((chain: any) => {
          try {
            t.send3p('ajs', chain.payload);
          } catch (e) {
            logger: t.logger.warn('Failed to send an event', e)
          }

          if (dropLastSegmentEvent) {
            dropLastSegmentEvent = false;
          } else {
            chain.next(chain.payload);
          }
        });
        dropLastSegmentEvent = true;
        analytics.page();
      }
    ).catch(e => {
      logger: t.logger.error(e);
    })
  }
};

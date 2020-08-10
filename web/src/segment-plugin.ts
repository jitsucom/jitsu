import { IEventnTracker, TrackerPlugin } from './types'

export default (globalPropName: string = 'analytics'): TrackerPlugin => {
  let dropLastSegmentEvent = false;
  return (t: IEventnTracker) => {
    const analytics = (window as any)[globalPropName];
    if (!analytics || typeof analytics.addSourceMiddleware !== 'function') {
      return;
    }

    analytics.addSourceMiddleware((chain:any) => {
      try {
        t.send3p('ajs', chain.payload);
      } catch (e) {
        // LOG.warn('Failed to send an event', e)
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
};

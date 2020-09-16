import {Tracker, TrackerPlugin} from './types'
import {awaitGlobalProp} from './helpers'


export default (globalPropName: string = 'analytics'): TrackerPlugin => {
    let dropLastSegmentEvent = false;
    return (t: Tracker) => {
        awaitGlobalProp(globalPropName).then(
            (analytics: any) => {
                if (!analytics || typeof analytics.addSourceMiddleware !== 'function') {
                    logger: t.logger.error('analytics.addSourceMiddleware is not a function', analytics)
                    return;
                }
                let interceptor = (chain: any) => {
                    try {
                        let payload =  {...chain.payload}
                        payload.type = chain.payload.type()
                        let u = analytics.user()
                        if (u) {
                            payload.obj.user_id = u.id()
                        }
                        t.send3p('ajs', payload);
                    } catch (e) {
                        logger: t.logger.warn('Failed to send an event', e)
                    }

                    if (dropLastSegmentEvent) {
                        dropLastSegmentEvent = false;
                    } else {
                        chain.next(chain.payload);
                    }
                };

                analytics.addSourceMiddleware(interceptor);
                dropLastSegmentEvent = true;
                analytics.page();
            }
        ).catch(e => {
            logger: t.logger.error("Can't get segment object", e);
        })
    }
};

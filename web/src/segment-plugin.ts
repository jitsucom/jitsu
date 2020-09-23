import {Tracker, TrackerPlugin} from './types'
import {awaitGlobalProp} from './helpers'


export default (globalPropName: string = 'analytics'): TrackerPlugin => {
    return (t: Tracker) => {
        awaitGlobalProp(globalPropName).then(
            (analytics: any) => {
                if (!analytics['__en_intercepted']) {
                    t.interceptAnalytics(analytics)
                }
            }
        ).catch(e => {
            t.logger.error("Can't get segment object", e);
        })
    }
};

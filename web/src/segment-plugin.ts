import {Tracker, TrackerPlugin} from './types'
import {awaitGlobalProp} from './helpers'


export default (globalPropName: string = 'analytics'): TrackerPlugin => {
    return (t: Tracker) => {
        awaitGlobalProp(globalPropName).then(
            (analytics: any) => {
                t.interceptAnalytics(t, analytics)
            }
        ).catch(e => {
            logger: t.logger.error("Can't get segment object", e);
        })
    }
};

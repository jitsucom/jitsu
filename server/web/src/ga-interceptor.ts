import {Tracker, TrackerPlugin} from './types'
import {awaitGlobalProp, parseQuery} from './helpers';

let dropLastGAEvent = false;

export function interceptGoogleAnalytics(t: Tracker, globalPropName: string = 'ga') {
    awaitGlobalProp(globalPropName).then(
        (ga: any) => {
            ga(
                (tracker: any) => {
                    const originalSendHitTask = tracker.get('sendHitTask');
                    tracker.set('sendHitTask', (model: any) => {
                        var payLoad = model.get('hitPayload');
                        if (dropLastGAEvent) {
                            dropLastGAEvent = false;
                        } else {
                            originalSendHitTask(model);
                        }
                        t._send3p('ga', mapGaPayload(parseQuery(payLoad)));
                    });
                }
            );
            dropLastGAEvent = true
            try {
                ga('send', 'pageview');
            } finally {
                dropLastGAEvent = false;
            }
        },
    ).catch(
        (e) => {
            logger: {
                t.logger.error(e)
            }
        }
    );
}


const propsMap = {
    cc: 'campaign_context',
    cid: 'client_id',
    cm: 'campaign_medium',
    cn: 'campaign_name',
    cos: 'checkout_step',
    cs: 'campaign_source',
    de: 'document_encoding',
    dh: 'hostname',
    dl: 'url',
    dp: 'path',
    dr: 'referrer',
    ds: 'datasource',
    dt: 'document_title',
    ea: 'event_action',
    ec: 'event_category',
    el: 'event_label',
    ev: 'event_value',
    ic: 'item_code',
    in: 'item_name',
    ip: 'item_price',
    iq: 'item_quality',
    iv: 'item_category',
    je: 'java_installed',
    sc: 'session_control',
    sd: 'screen_color',
    sr: 'screen_size',
    t: 'event_type',
    tcc: 'coupon_code',
    ti: 'transaction_id',
    tid: 'ga_property',
    tr: 'transaction_revenue',
    ts: 'transaction_shipping',
    tt: 'transaction_tax',
    ua: 'user_agent_override',
    uid: 'user_id',
    uip: 'user_ip_override',
    ul: 'user_language',
    v: 'ga_protocol_version',
    vp: 'viewport_size',
    _gid: 'ga_user_id',
} as Record<string, string>;

const mapGaPayload = (data: Record<string, string>) => Object.entries(data).reduce(
    (res, [k, v]) => {
        const tp = propsMap[k];
        if (tp !== undefined) {
            res[tp] = v;
        }
        return res;
    },
    {} as Record<string, string>,
);

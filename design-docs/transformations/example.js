//import './transformations.d.ts'

function transform() {

}

module.exports = {
  transform: (event) => {
    let result = {};
    let destination_table;
    if (event.event_type === 'user_indentity' || event.event_type === 'identify') {
      destination_table = "identities";
    } else if (event.event_type === 'page' || event.event_type === "pageview") {
      destination_table = "pages";
    } else {
      destination_table = event.event_type;
    }

    result.source_id = event.source_ip;
    result.context_library_name = event.src_payload?.obj?.context?.library?.name;
    result.context_page_search = event.src_payload?.obj?.context?.page?.search || event.eventn_ctx?.doc_search;
    result.search = event.src_payload?.obj?.context?.page?.search || event.eventn_ctx?.doc_search;
    result.context_page_title = result.title = event.src_payload?.obj?.context?.page?.title || event.eventn_ctx?.page_title;

    result.name = event.src_payload?.obj?.name || event.eventn_ctx?.user?.name || event.src_payload?.obj?.traits?.name;

    result.context_page_url = result.url = event.src_payload?.obj?.context?.page?.url || event.eventn_ctx?.url;

    result.path = result.context_page_path = event.src_payload?.obj?.context?.page?.url || event.eventn_ctx?.url;

    result.user_id = event.eventn_ctx?.user?.internal_id || event.src_payload?.obj?.userId;

    result.anonymous_id = event.src_payload?.obj?.anonymousId || event.eventn_ctx?.user?.anonymous_id;

    result.context_library_version = event.src_payload?.obj?.context?.library?.version

    result.context_locale = event.src_payload?.obj?.context?.locale;

    result.context_user_agent = event.src_payload?.obj?.context?.page?.userAgent || event.eventn_ctx?.user_agent;

    result.referrer = result.context_page_referrer = event.src_payload?.obj?.context?.page?.referrer || event.eventn_ctx?.referer


    result.context_campaign_source = event.src_payload?.obj?.context?.campaign?.name || event?.eventn_ctx?.utm?.campaign;
    result.email = event.src_payload?.obj?.traits?.email || event?.eventn_ctx?.user?.email;

    result.context_utm_source = event.src_payload?.obj?.context?.campaign?.source || event.eventn_ctx?.utm?.source;

    result.sent_at = event.src_payload?.obj?.sentAt || event.eventn_ctx?.utc_time;

    return [destination_table, result];
  }
}
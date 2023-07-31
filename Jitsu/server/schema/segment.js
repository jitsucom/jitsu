function toSegment($) {
  function tableName($) {
    switch ($.event_type) {
      case "user_identify":
      case "identify":
        return "identifies";
      case "page":
      case "pageview":
        return "pages";
      default:
        return $.event_type;
    }
  }

  const context = $.eventn_ctx || $;
  const user = context.user || {};
  const utm = context.utm || {};
  const payloadObj = $.src_payload?.obj || {};
  const page = payloadObj.context?.page || {};

  return {
    JITSU_TABLE_NAME: tableName($),
    name: $.src_payload?.name || payloadObj.traits?.name,
    title: context.page_title || page.title,
    url: context.url || page.url,
    user_id: user.id || user.internal_id || payloadObj.userId,
    anonymous_id: user.anonymous_id || payloadObj.anonymousId,
    context_library_version: payloadObj.context?.library?.version,
    context_page_referrer: page.referrer,
    context_page_url: page.url,
    context_user_agent: context.user_agent || page.userAgent,
    referrer: context.referer || page.referrer,
    context_page_search: page.search,
    timestamp: payloadObj.timestamp && new Date(payloadObj.timestamp),
    __sql_type_timestamp: ["timestamp"],
    context_ip: $.source_ip,
    context_library_name: payloadObj.context?.library?.name,
    id: payloadObj.messageId,
    sent_at:
      (context.utc_time && new Date(context.utc_time)) ||
      (payloadObj.sentAt && new Date(payloadObj.sentAt)),
    __sql_type_sent_at: ["timestamp"],
    context_locale: context.user_language || payloadObj.context?.locale,
    context_page_path: page.path,
    context_page_title: page.title,
    email: user.email || payloadObj.traits?.email,
    context_campaign_source: utm.campaign,
    app: $.app,
    path: context.doc_path,
    search: context.doc_search,
    context_utm_source: utm.source,
  };
}

function toAmplitude($) {
  const context = $.eventn_ctx || $;
  const user = context.user || {};
  const utm = context.utm || {};

  return {
    user_id: user.email,
    device_id: user.anonymous_id,
    event_type: $.event_type,
    os_name: context.parsed_ua?.os_family,
    os_version: context.parsed_ua?.os_version,
    device_brand: context.parsed_ua?.device_brand,
    device_manufacturer: context.parsed_ua?.device_family,
    device_model: context.parsed_ua?.device_model,
    country: context.location?.country,
    region: context.location?.region,
    city: context.location?.city,
    language: context.user_language,
    location_lat: context.location?.latitude,
    location_lng: context.location?.longitude,
    ip: $.source_ip,
    insert_id: $.eventn_ctx_event_id || context.event_id,
    user_agent: context.user_agent,
    event_properties: {
      url: context.url,
      utm: utm,
      click_id: context.click_id,
      host: context.doc_host,
      path: context.doc_path,
      search: context.doc_search,
      app: $.app,
      referrer: context.referer,
      title: context.page_title,
      src: $.src,
      user_agent: context.user_agent,
      vp_size: $.vp_size,
      local_tz_offset: context.local_tz_offset,
    },
  };
}

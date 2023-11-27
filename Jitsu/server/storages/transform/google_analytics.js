function toGoogleAnalytics($) {
  const context = $.eventn_ctx || $;
  const user = context.user || {};
  const utm = context.utm || {};
  const click = context.click_id || {};
  const conversion = context.conversion || {};

  return {
    t: $.event_type,
    aip: 0,
    ds: "jitsu",
    cid: user.anonymous_id,
    uid: user.id,
    ua: context.user_agent,
    uip: $.source_ip,
    dr: context.referer,
    cn: utm.campaign,
    cs: utm.source,
    cm: utm.medium,
    ck: utm.term,
    cc: utm.content,
    gclid: click.gclid,
    dclid: click.dclid,
    sr: context.screen_resolution,
    vp: context.vp_size,
    de: context.doc_encoding,
    dl: context.url,
    dh: context.doc_host,
    dp: context.doc_path,
    dt: context.page_title,
    ul: context.user_language,
    ti: conversion.transaction_id,
    ta: conversion.affiliation,
    tr: conversion.revenue,
    ts: conversion.shipping,
    tt: conversion.tt,
  };
}

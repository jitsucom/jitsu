function JitsuTransformFunction(
  $,
  {
    userProfileUpdates = {},
    additionalProperties = {},
    overriddenEventName = "",
  } = {}
) {
  const context = $.eventn_ctx || $;
  const user = context.user || {};
  const utm = context.utm || {};
  const location = context.location || {};
  const ua = context.parsed_ua || {};
  const conversion = context.conversion || {};

  const matches = context.referer?.match(
    /^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i
  );
  const refDomain = matches && matches[1]; // domain will be null if no match is found

  const mustUpdateUserProfile =
    globalThis.users_enabled &&
    (user.internal_id || user.email || globalThis.anonymous_users_enabled);

  function getEventType($) {
    switch ($.event_type) {
      case "user_identify":
      case "identify":
        return "$identify";
      case "page":
      case "pageview":
      case "site_page":
        return "Page View";
      default:
        return $.event_type;
    }
  }

  const eventType = getEventType($);

  let envelops = [];
  let $set = {};
  let $set_once = {};
  let $add = {};

  //on identify
  if (eventType === "$identify") {
    //create an alias user id -> anon id
    if (
      (user.internal_id || user.email) &&
      (user.anonymous_id || user.hashed_anonymous_id)
    ) {
      envelops.push({
        JITSU_ENVELOP: {
          url: "https://api.mixpanel.com/track",
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body:
            "data=" +
            encodeURIComponent(
              JSON.stringify({
                event: "$create_alias",
                properties: {
                  alias: user.anonymous_id || user.hashed_anonymous_id,
                  distinct_id: user.internal_id || user.email,
                  token: globalThis.token,
                },
              })
            ),
        },
      });
    }

    if (mustUpdateUserProfile) {
      $set = {
        $email: user.email,
        $name: user.name,
        $username: user.username,
        $first_name: user.firstName || user.first_name,
        $last_name: user.lastName || user.last_name,
        $phone: user.phone,
        $avatar: user.avatar,
        $country_code: location.country,
        $city: location.city,
        $region: location.region,
        $browser: ua.ua_family,
        $browser_version: ua.ua_version,
        $os: ua.os_family,
        $referring_domain: refDomain,
      };
      //Set User Profile Properties Once
      $set_once = {
        $initial_referrer: context.referer || "$direct",
        $initial_referring_domain: refDomain || "$direct",
      };
    }
  }
  if (eventType !== "$identify") {
    envelops.push({
      JITSU_ENVELOP: {
        url: "https://api.mixpanel.com/track",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body:
          "data=" +
          encodeURIComponent(
            JSON.stringify({
              event: overriddenEventName || eventType,
              properties: {
                token: globalThis.token,
                time: new Date($._timestamp).getTime(),
                $insert_id: $.eventn_ctx_event_id || context.event_id,
                $current_url: context.url,
                $referrer: context.referer,
                $referring_domain: refDomain,
                $identified_id: user.internal_id || user.email,
                $anon_id: user.anonymous_id || user.hashed_anonymous_id,
                $distinct_id:
                  user.internal_id ||
                  user.email ||
                  user.anonymous_id ||
                  user.hashed_anonymous_id,
                distinct_id:
                  user.internal_id ||
                  user.email ||
                  user.anonymous_id ||
                  user.hashed_anonymous_id,
                $email: user.email,
                ip: $.source_ip,
                $browser: ua.ua_family,
                $browser_version: ua.ua_version,
                $os: ua.os_family,
                $city: location.city,
                $region: location.region,
                $country_code: location.country,
                mp_country_code: location.country,
                $screen_width: context.screen_resolution?.split("x")[0],
                $screen_height: context.screen_resolution?.split("x")[1],
                utm_medium: utm.medium,
                utm_source: utm.source,
                utm_campaign: utm.campaign,
                utm_content: utm.content,
                utm_term: utm.term,
                Revenue: conversion.revenue || $.revenue,
                ...additionalProperties,
              },
            })
          ),
      },
    });

    if (mustUpdateUserProfile) {
      $set = {
        [`Last ${overriddenEventName || eventType}`]: $._timestamp,
      };
      $add = {
        [overriddenEventName || eventType]: 1,
      };
      if (conversion.revenue || $.revenue) {
        $add["Lifetime Revenue"] = conversion.revenue || $.revenue;
      }
    }
  }

  if (mustUpdateUserProfile) {
    //Set User Profile Properties

    userProfileUpdates = {
      ...userProfileUpdates,
      $set: { ...$set, ...userProfileUpdates?.$set },
      $set_once: { ...$set_once, ...userProfileUpdates?.$set_once },
      $add: { ...$add, ...userProfileUpdates?.$add },
    };

    //Make a separate API request for engageObject properties.
    //Use batch update for updating multiple properties with one request
    let engages = [];
    Object.keys(userProfileUpdates).forEach((key) => {
      const engage = userProfileUpdates[key];

      if (Object.keys(engage).length > 0) {
        engages.push({
          $token: globalThis.token,
          $distinct_id:
            user.internal_id ||
            user.email ||
            user.anonymous_id ||
            user.hashed_anonymous_id,
          $ip: $.source_ip,
          [key]: engage,
        });
      }
    });
    if (engages.length > 0) {
      envelops.push({
        JITSU_ENVELOP: {
          url: "https://api.mixpanel.com/engage",
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "data=" + encodeURIComponent(JSON.stringify(engages)),
        },
      });
    }
  }
  return envelops;
}

import {
  intType,
  isoUtcDateType,
  oauthSecretType,
  passwordType,
  selectionType,
  SourceConnector,
  stringType,
} from "../types"
import { googleServiceAuthDocumentation } from "./documentation"

import { googleAuthConfigParameters } from "./commonParams"

function expandGACustom(metricsOrDimensions: string[]) {
  return metricsOrDimensions.flatMap(f => {
    if (f.endsWith('XX')) {
      const arr = []
      for (let i = 1; i <= 20; i++) {
        arr.push(f.replace('XX', i.toString()))
      }
      return arr
    }
    return f
  })
}

export const facebook: SourceConnector = {
  pic: (
    <svg height="100%" width="100%" viewBox="0 0 36 36" fill="url(#gradient)">
      <defs>
        <linearGradient x1="50%" x2="50%" y1="97.0782153%" y2="0%" id="gradient">
          <stop offset="0%" stopColor="#0062E0" />
          <stop offset="100%" stopColor="#19AFFF" />
        </linearGradient>
      </defs>
      <path d="M15 35.8C6.5 34.3 0 26.9 0 18 0 8.1 8.1 0 18 0s18 8.1 18 18c0 8.9-6.5 16.3-15 17.8l-1-.8h-4l-1 .8z" />
      <path
        fill="white"
        d="M25 23l.8-5H21v-3.5c0-1.4.5-2.5 2.7-2.5H26V7.4c-1.3-.2-2.7-.4-4-.4-4.1 0-7 2.5-7 7v4h-4.5v5H15v12.7c1 .2 2 .3 3 .3s2-.1 3-.3V23h4z"
      />
    </svg>
  ),
  documentation: {
    overview: (
      <>
        The Facebook connector pulls data from{" "}
        <a target="_blank" href="https://developers.facebook.com/docs/marketing-api/insights/">
          Facebook Insights API
        </a>
        . The connector is highly configurable and can pull data broken down by any dimensions from ads-, adset-,
        campaign- or account-level data
      </>
    ),
    connection: (
      <>
        <h1>1. Obtain Facebook Account ID</h1>
        Facebook has a great article about{" "}
        <a target="_blank" href="https://www.facebook.com/business/help/1492627900875762">
          How to get Facebook Account ID
        </a>
        <h1>2. Generate Short-lived (1 hour) Facebook Access token</h1>
        <ul>
          <li>
            Go to{" "}
            <a target="_blank" href="https://developers.facebook.com/tools/explorer">
              Facebook Graph API Explorer
            </a>{" "}
            page
          </li>
          <li>Select Facebook app which has access to your Facebook advertisements data</li>
          <li>Select User token</li>
          <li>
            Select two permissions: <code>read_insights</code> and <code>ads_read</code>
          </li>
          <li>Click Generate Access Token</li>
        </ul>
        <h1>3. Generate Long-lived (60 days) Facebook Access token</h1>
        For generating long lived access token please read{" "}
        <a
          target="_blank"
          href="https://developers.facebook.com/docs/pages/access-tokens/#get-a-long-lived-user-access-token"
        >
          Facebook article
        </a>
      </>
    ),
  },
  collectionParameters: [
    {
      applyOnlyTo: "ads",
      displayName: "Report Fields",
      id: "fields",
      // prettier-ignore
      type: selectionType(['bid_amount', 'adlabels', 'creative', 'status', 'created_time', 'updated_time', 'targeting', 'effective_status', 'campaign_id', 'adset_id', 'conversion_specs', 'recommendations', 'id', 'bid_info', 'last_updated_by_app_id', 'tracking_specs', 'bid_type', 'name', 'account_id', 'source_ad_id']),
      required: true,
      documentation: <>Ads fields to download</>,
    },
    {
      applyOnlyTo: "insights",
      displayName: "Report Fields",
      id: "fields",
      // prettier-ignore
      type: selectionType(['account_currency', 'account_id', 'account_name', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'objective', 'buying_type', 'cpc', 'cpm', 'cpp', 'ctr', 'estimated_ad_recall_rate', 'estimated_ad_recallers', 'reach', 'unique_clicks', 'unique_ctr', 'frequency', 'actions', 'conversions', 'spend', 'impressions']),
      required: true,
      documentation: <>Insights fields to download</>,
    },
    {
      displayName: "Level of data",
      id: "level",
      defaultValue: "ad",
      type: selectionType(["ad", "adset", "campaign", "account"], 1),
      documentation: (
        <>
          One of [ad, adset, campaign, account].{" "}
          <a target="_blank" href="https://developers.facebook.com/docs/marketing-api/reference/adgroup/insights/">
            Read more about level
          </a>
        </>
      ),
    },
  ],
  displayName: "Facebook Marketing",
  id: "facebook_marketing",
  collectionTypes: ["insights", "ads"],
  configParameters: [
    {
      displayName: "Account ID",
      id: "config.account_id",
      type: stringType,
      required: true,
      documentation: (
        <>
          <a target="_blank" href="https://www.facebook.com/business/help/1492627900875762" rel="noreferrer">
            How to get Facebook Account ID
          </a>
        </>
      ),
    },
    {
      displayName: "Access Token",
      id: "config.access_token",
      type: stringType,
      required: true,
      documentation: (
        <>
          <a
            target="_blank"
            href="https://developers.facebook.com/docs/pages/access-tokens/#get-a-long-lived-user-access-token"
            rel="noreferrer"
          >
            How to get Facebook Access Token
          </a>
        </>
      ),
    },
  ],
}

export const googleAds: SourceConnector = {
  pic: (
    <svg height="100%" viewBox="0 0 192 192" width="100%" xmlns="http://www.w3.org/2000/svg">
      <g className="_ngcontent-awn-AWSM-2">
        <rect fill="none" height="192" width="192" className="_ngcontent-awn-AWSM-2"></rect>
        <g className="_ngcontent-awn-AWSM-2">
          <rect
            fill="#FBBC04"
            height="58.67"
            transform="matrix(0.5 -0.866 0.866 0.5 -46.2127 103.666)"
            width="117.33"
            x="8"
            y="62.52"
            className="_ngcontent-awn-AWSM-2"
          ></rect>
          <path
            d="M180.07,127.99L121.4,26.38c-8.1-14.03-26.04-18.84-40.07-10.74c-14.03,8.1-18.84,26.04-10.74,40.07 l58.67,101.61c8.1,14.03,26.04,18.83,40.07,10.74C183.36,159.96,188.16,142.02,180.07,127.99z"
            fill="#4285F4"
            className="_ngcontent-awn-AWSM-2"
          ></path>
          <circle cx="37.34" cy="142.66" fill="#34A853" r="29.33" className="_ngcontent-awn-AWSM-2"></circle>
        </g>
      </g>
    </svg>
  ),
  collectionParameters: [
    {
      displayName: "Fields",
      documentation: (
        <>
          {" "}
          Use{" "}
          <a target="_blank" href="https://developers.google.com/google-ads/api/fields/v8/overview_query_builder">
            Google Ads Query Builder
          </a>{" "}
          tool to build required query. Copy comma-separated field list from resulting GAQL query (part between SELECT
          and FROM keywords). Don't forget to add date segments (e.g. segments.date) where it is necessary.
        </>
      ),
      id: "fields",
      // prettier-ignore
      type: stringType,
      required: true,
    },
    {
      displayName: "Start Date",
      id: "start_date",
      type: isoUtcDateType,
      defaultValue: "2020-01-01",
      required: true,
    },
  ],
  collectionTemplates: [
    {
      templateName: "Default Google Ads template",
      description: <></>,
      collections: [
        {
          type: "label",
          name: "labels",
          parameters: {
            fields:
              "label.name, label.resource_name, label.id, label.status, label.text_label.background_color, label.text_label.description",
            start_date: "2020-01-01",
          },
        },
        {
          type: "user_location_view",
          name: "user_location_report",
          parameters: {
            fields:
              "metrics.cost_micros, metrics.interactions, campaign.id, metrics.all_conversions, metrics.average_cpv, metrics.average_cpm, metrics.value_per_all_conversions, customer.currency_code, customer.descriptive_name, user_location_view.resource_name, metrics.average_cost, metrics.impressions, metrics.interaction_event_types, metrics.value_per_conversion, customer.time_zone, metrics.average_cpc, metrics.clicks, ad_group.name, ad_group.status, metrics.video_view_rate, metrics.view_through_conversions, segments.ad_network_type, metrics.all_conversions_value, metrics.cost_per_conversion, metrics.cross_device_conversions, metrics.ctr, metrics.conversions, metrics.interaction_rate, metrics.video_views, customer.id, user_location_view.country_criterion_id, campaign.status, ad_group.base_ad_group, metrics.all_conversions_from_interactions_rate, campaign.base_campaign, campaign.name, metrics.conversions_from_interactions_rate, metrics.conversions_value, metrics.cost_per_all_conversions, segments.date",
            start_date: "2020-01-01",
          },
        },
        {
          type: "shopping_performance_view",
          name: "shopping_performance_report",
          parameters: {
            fields:
              "segments.product_bidding_category_level3, segments.product_channel, metrics.cost_per_conversion, metrics.cross_device_conversions, segments.product_custom_attribute4, metrics.value_per_conversion, segments.product_bidding_category_level1, segments.product_bidding_category_level4, segments.product_type_l4, campaign.name, metrics.ctr, segments.product_type_l2, campaign.status, segments.product_title, customer.descriptive_name, segments.product_country, customer.id, segments.product_item_id, metrics.all_conversions_value, metrics.conversions_value, segments.product_language, segments.product_type_l1, segments.product_aggregator_id, segments.product_merchant_id, metrics.value_per_all_conversions, ad_group.id, metrics.all_conversions, metrics.conversions, metrics.cost_micros, segments.product_custom_attribute0, metrics.impressions, ad_group.name, segments.product_custom_attribute2, segments.product_type_l3, segments.product_type_l5, campaign.id, segments.product_custom_attribute3, ad_group.status, metrics.average_cpc, segments.product_bidding_category_level2, segments.product_bidding_category_level5, metrics.clicks, metrics.all_conversions_from_interactions_rate, segments.product_brand, segments.product_channel_exclusivity, segments.product_custom_attribute1, segments.ad_network_type, metrics.conversions_from_interactions_rate, metrics.cost_per_all_conversions, segments.product_store_id, segments.click_type, segments.device, segments.product_condition, segments.date",
            start_date: "2020-01-01",
          },
        },
        {
          type: "topic_view",
          name: "display_topics_performance",
          parameters: {
            fields:
              "segments.date,metrics.video_quartile_p25_rate,metrics.cost_micros,ad_group_criterion.topic.path,customer.id,campaign.status,metrics.conversions,metrics.cost_per_conversion,metrics.active_view_viewability,ad_group.id,ad_group_criterion.final_mobile_urls,segments.ad_network_type,metrics.average_cpv,ad_group_criterion.effective_cpm_bid_micros,metrics.gmail_secondary_clicks,metrics.conversions_from_interactions_rate,metrics.gmail_saves,metrics.interactions,metrics.video_quartile_p50_rate,metrics.active_view_measurable_impressions,metrics.all_conversions,ad_group_criterion.bid_modifier,metrics.gmail_forwards,metrics.video_quartile_p100_rate,segments.device,metrics.view_through_conversions,metrics.active_view_cpm,metrics.average_cpe,campaign.bidding_strategy_type,campaign.name,metrics.cross_device_conversions,metrics.interaction_rate,ad_group_criterion.negative,ad_group.status,metrics.all_conversions_from_interactions_rate,campaign.base_campaign,metrics.conversions_value,ad_group_criterion.effective_cpc_bid_micros,ad_group_criterion.topic.topic_constant,customer.descriptive_name,campaign.id,ad_group_criterion.criterion_id,ad_group_criterion.tracking_url_template,ad_group_criterion.url_custom_parameters,ad_group_criterion.effective_cpc_bid_source,ad_group_criterion.effective_cpm_bid_source,metrics.engagement_rate,metrics.value_per_conversion,metrics.active_view_ctr,metrics.average_cpm,campaign.bidding_strategy,metrics.value_per_all_conversions,metrics.video_view_rate,metrics.active_view_measurability,metrics.cost_per_all_conversions,metrics.video_views,metrics.active_view_impressions,metrics.clicks,metrics.engagements,ad_group_criterion.final_urls,metrics.impressions,ad_group_criterion.status,ad_group.name,metrics.average_cost,metrics.average_cpc,ad_group.base_ad_group,metrics.ctr,ad_group.targeting_setting.target_restrictions,metrics.video_quartile_p75_rate,customer.currency_code,customer.time_zone,metrics.active_view_measurable_cost_micros,metrics.all_conversions_value,metrics.interaction_event_types",
            start_date: "2020-01-01",
          },
        },
        {
          type: "display_keyword_view",
          name: "display_keywords_performance",
          parameters: {
            fields:
              "metrics.active_view_measurable_cost_micros, ad_group_criterion.final_urls, metrics.video_quartile_p50_rate, metrics.video_views, campaign.bidding_strategy, campaign.id, metrics.video_view_rate, metrics.average_cpe, metrics.engagement_rate, metrics.gmail_secondary_clicks, metrics.view_through_conversions, ad_group_criterion.effective_cpm_bid_micros, ad_group_criterion.effective_cpv_bid_micros, metrics.cross_device_conversions, ad_group_criterion.negative, metrics.value_per_conversion, metrics.video_quartile_p100_rate, metrics.active_view_viewability, segments.ad_network_type, metrics.cost_per_all_conversions, ad_group_criterion.effective_cpc_bid_micros, ad_group_criterion.effective_cpv_bid_source, segments.device, ad_group.targeting_setting.target_restrictions, metrics.active_view_measurability, metrics.average_cpc, ad_group_criterion.tracking_url_template, customer.currency_code, campaign.base_campaign, metrics.conversions, ad_group_criterion.effective_cpm_bid_source, ad_group_criterion.criterion_id, metrics.interaction_event_types, ad_group_criterion.url_custom_parameters, metrics.average_cost, ad_group_criterion.keyword.text, metrics.engagements, metrics.interactions, customer.descriptive_name, metrics.active_view_measurable_impressions, metrics.average_cpm, metrics.gmail_saves, ad_group_criterion.status, ad_group.status, metrics.conversions_from_interactions_rate, ad_group_criterion.effective_cpc_bid_source, customer.id, ad_group_criterion.final_mobile_urls, metrics.active_view_ctr, metrics.cost_per_conversion, metrics.video_quartile_p75_rate, ad_group.name, metrics.all_conversions_value, metrics.all_conversions, metrics.average_cpv, metrics.gmail_forwards, ad_group.id, campaign.name, campaign.status, metrics.value_per_all_conversions, customer.time_zone, metrics.active_view_cpm, metrics.all_conversions_from_interactions_rate, campaign.bidding_strategy_type, metrics.conversions_value, metrics.ctr, metrics.video_quartile_p25_rate, metrics.active_view_impressions, ad_group.base_ad_group, metrics.clicks, metrics.cost_micros, metrics.impressions,metrics.interaction_rate,segments.date",
            start_date: "2020-01-01",
          },
        },
        {
          type: "campaign",
          name: "campaigns",
          parameters: {
            fields:
              "campaign.target_cpa.cpc_bid_ceiling_micros,campaign.target_impression_share.cpc_bid_ceiling_micros,campaign.target_roas.cpc_bid_ceiling_micros,campaign.tracking_url_template,campaign.bidding_strategy,campaign.excluded_parent_asset_field_types,campaign.id,campaign.serving_status,campaign.optimization_score,campaign.real_time_bidding_setting.opt_in,campaign.app_campaign_setting.app_store,campaign.dynamic_search_ads_setting.language_code,campaign.end_date,campaign.final_url_suffix,campaign.local_campaign_setting.location_source_type,campaign.manual_cpv,campaign.target_cpa.target_cpa_micros,campaign.target_spend.target_spend_micros,campaign.experiment_type,campaign.manual_cpm,campaign.status,campaign.tracking_setting.tracking_url,campaign.video_brand_safety_suitability,campaign.target_impression_share.location,campaign.target_roas.cpc_bid_floor_micros,campaign.app_campaign_setting.bidding_strategy_goal_type,campaign.labels,campaign.manual_cpc.enhanced_cpc_enabled,campaign.network_settings.target_content_network,campaign.optimization_goal_setting.optimization_goal_types,campaign.percent_cpc.cpc_bid_ceiling_micros,campaign.frequency_caps,campaign.targeting_setting.target_restrictions,campaign.advertising_channel_type,campaign.geo_target_type_setting.positive_geo_target_type,campaign.hotel_setting.hotel_center_id,campaign.network_settings.target_google_search,campaign.percent_cpc.enhanced_cpc_enabled,campaign.accessible_bidding_strategy,campaign.commission.commission_rate_micros,campaign.geo_target_type_setting.negative_geo_target_type,campaign.ad_serving_optimization_status,campaign.app_campaign_setting.app_id,campaign.campaign_budget,campaign.target_impression_share.location_fraction_micros,campaign.dynamic_search_ads_setting.domain_name,campaign.payment_mode,campaign.vanity_pharma.vanity_pharma_display_url_mode,campaign.bidding_strategy_type,campaign.maximize_conversion_value.target_roas,campaign.target_cpa.cpc_bid_floor_micros,campaign.advertising_channel_sub_type,campaign.base_campaign,campaign.name,campaign.resource_name,campaign.selective_optimization.conversion_actions,campaign.shopping_setting.enable_local,campaign.network_settings.target_partner_search_network,campaign.target_roas.target_roas,campaign.target_spend.cpc_bid_ceiling_micros,campaign.url_custom_parameters,campaign.vanity_pharma.vanity_pharma_text,campaign.dynamic_search_ads_setting.feeds,campaign.dynamic_search_ads_setting.use_supplied_urls_only,campaign.network_settings.target_search_network,campaign.shopping_setting.campaign_priority,campaign.shopping_setting.sales_country,campaign.shopping_setting.merchant_id,campaign.start_date",
            start_date: "2020-01-01",
          },
        },
        {
          type: "ad_group",
          name: "ad_groups",
          parameters: {
            fields:
              "ad_group.id,ad_group.percent_cpc_bid_micros,ad_group.effective_target_roas_source,ad_group.final_url_suffix,ad_group.labels,ad_group.ad_rotation_mode,ad_group.base_ad_group,ad_group.effective_target_cpa_source,ad_group.type,ad_group.effective_target_cpa_micros,ad_group.effective_target_roas,ad_group.excluded_parent_asset_field_types,ad_group.resource_name,ad_group.target_cpm_micros,ad_group.target_roas,ad_group.cpc_bid_micros,ad_group.status,ad_group.name,ad_group.campaign,ad_group.targeting_setting.target_restrictions,ad_group.tracking_url_template,ad_group.url_custom_parameters,ad_group.cpm_bid_micros,ad_group.cpv_bid_micros,ad_group.display_custom_bid_dimension,ad_group.target_cpa_micros",
            start_date: "2020-01-01",
          },
        },
        {
          type: "ad_group_ad",
          name: "ad_group_ad_performance",
          parameters: {
            fields:
              "ad_group_ad.policy_summary.approval_status,ad_group_ad.ad.final_mobile_urls,ad_group_ad.ad.image_ad.mime_type,metrics.interaction_rate,ad_group_ad.ad.responsive_display_ad.accent_color,ad_group_ad.ad.responsive_display_ad.headlines,metrics.value_per_conversion,ad_group_ad.ad.legacy_responsive_display_ad.business_name,metrics.conversions_from_interactions_rate,metrics.cost_per_conversion,ad_group_ad.ad.legacy_responsive_display_ad.format_setting,ad_group_ad.ad.expanded_text_ad.headline_part1,ad_group_ad.ad.responsive_display_ad.long_headline,ad_group_ad.ad.app_ad.images,customer.time_zone,metrics.active_view_measurable_cost_micros,metrics.average_cpv,ad_group_ad.ad.id,ad_group_ad.ad.responsive_display_ad.allow_flexible_color,ad_group_ad.ad.responsive_search_ad.path2,metrics.all_conversions_value,metrics.average_page_views,ad_group_ad.ad.expanded_text_ad.path1,customer.descriptive_name,ad_group_ad.ad.tracking_url_template,metrics.gmail_saves,ad_group_ad.ad.app_ad.mandatory_ad_text,metrics.conversions,segments.date,ad_group_ad.ad.legacy_responsive_display_ad.marketing_image,ad_group_ad.ad.responsive_display_ad.format_setting,ad_group_ad.ad.responsive_display_ad.youtube_videos,ad_group_ad.ad.app_ad.headlines,ad_group_ad.ad.legacy_responsive_display_ad.accent_color,metrics.value_per_current_model_attributed_conversion,ad_group.status,ad_group_ad.ad.legacy_responsive_display_ad.allow_flexible_color,metrics.average_cpe,campaign.id,ad_group_ad.ad.final_urls,metrics.engagement_rate,ad_group_ad.ad.responsive_display_ad.call_to_action_text,ad_group_ad.ad.responsive_display_ad.business_name,metrics.active_view_measurability,metrics.all_conversions_from_interactions_rate,metrics.conversions_value,ad_group_ad.ad.image_ad.pixel_height,ad_group_ad.ad.responsive_display_ad.main_color,metrics.active_view_cpm,ad_group_ad.ad.legacy_responsive_display_ad.call_to_action_text,ad_group_ad.ad.legacy_responsive_display_ad.square_marketing_image,ad_group_ad.ad.responsive_display_ad.marketing_images,ad_group_ad.ad.responsive_display_ad.square_marketing_images,metrics.video_quartile_p75_rate,metrics.video_view_rate,metrics.cross_device_conversions,ad_group_ad.ad.device_preference,ad_group_ad.ad.responsive_search_ad.path1,ad_group_ad.ad.expanded_text_ad.description,metrics.engagements,ad_group_ad.ad.expanded_text_ad.path2,metrics.percent_new_visitors,metrics.video_quartile_p50_rate,metrics.active_view_ctr,metrics.active_view_viewability,metrics.cost_per_current_model_attributed_conversion,metrics.ctr,ad_group_ad.ad.expanded_dynamic_search_ad.description,customer.id,metrics.value_per_all_conversions,metrics.gmail_forwards,metrics.interaction_event_types,ad_group_ad.status,metrics.top_impression_percentage,ad_group_ad.ad.type,ad_group_ad.ad.url_custom_parameters,metrics.active_view_impressions,segments.ad_network_type,metrics.gmail_secondary_clicks,ad_group_ad.ad.app_ad.descriptions,ad_group.name,metrics.clicks,ad_group_ad.ad.text_ad.description1,ad_group_ad.ad.display_url,metrics.bounce_rate,campaign.status,metrics.interactions,ad_group_ad.ad.responsive_display_ad.promo_text,metrics.video_views,metrics.view_through_conversions,ad_group_ad.ad.added_by_google_ads,ad_group.base_ad_group,metrics.current_model_attributed_conversions,ad_group_ad.ad.responsive_display_ad.descriptions,ad_group_ad.ad.text_ad.headline,ad_group_ad.ad.legacy_responsive_display_ad.long_headline,ad_group_ad.ad.legacy_responsive_display_ad.main_color,ad_group_ad.ad.legacy_responsive_display_ad.price_prefix,ad_group_ad.ad.app_ad.html5_media_bundles,metrics.active_view_measurable_impressions,ad_group_ad.ad.responsive_display_ad.logo_images,ad_group_ad.ad_strength,metrics.average_time_on_site,campaign.name,ad_group_ad.ad.text_ad.description2,ad_group_ad.ad.legacy_responsive_display_ad.square_logo_image,ad_group_ad.ad.image_ad.image_url,ad_group_ad.ad.image_ad.name,customer.currency_code,ad_group_ad.ad_group,metrics.average_cpc,ad_group_ad.ad.image_ad.pixel_width,metrics.video_quartile_p100_rate,metrics.current_model_attributed_conversions_value,ad_group_ad.ad.expanded_text_ad.description2,ad_group_ad.ad.expanded_text_ad.headline_part2,ad_group_ad.ad.responsive_display_ad.price_prefix,metrics.average_cpm,campaign.base_campaign,ad_group_ad.ad.responsive_search_ad.headlines,ad_group_ad.ad.legacy_responsive_display_ad.short_headline,ad_group_ad.ad.app_ad.youtube_videos,metrics.all_conversions,metrics.average_cost,metrics.impressions,ad_group_ad.ad.legacy_responsive_display_ad.promo_text,metrics.video_quartile_p25_rate,metrics.cost_micros,metrics.cost_per_all_conversions,ad_group_ad.ad.expanded_text_ad.headline_part3,ad_group_ad.ad.responsive_display_ad.square_logo_images,ad_group_ad.ad.system_managed_resource_source,ad_group_ad.ad.legacy_responsive_display_ad.logo_image,ad_group_ad.ad.responsive_search_ad.descriptions",
            start_date: "2020-01-01",
          },
        },
        {
          type: "ad_group_ad",
          name: "ad_group_ads",
          parameters: {
            fields:
              "ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.square_marketing_images, ad_group_ad.labels, ad_group_ad.ad.call_ad.conversion_reporting_state, ad_group_ad.ad.call_ad.phone_number, ad_group_ad.ad.display_url, ad_group_ad.ad.hotel_ad, ad_group_ad.ad.name, ad_group_ad.ad.legacy_responsive_display_ad.logo_image, ad_group_ad.ad.legacy_responsive_display_ad.price_prefix, ad_group_ad.ad.legacy_responsive_display_ad.square_logo_image, ad_group_ad.ad.call_ad.call_tracked, ad_group_ad.ad.call_ad.conversion_action, ad_group_ad.ad.call_ad.description2, ad_group_ad.ad.call_ad.disable_call_conversion, ad_group_ad.ad.image_ad.preview_pixel_height, ad_group_ad.ad.local_ad.videos, ad_group_ad.ad.shopping_smart_ad, ad_group_ad.ad.video_ad.out_stream.headline, ad_group_ad.ad.display_upload_ad.media_bundle, ad_group_ad.ad.responsive_display_ad.accent_color, ad_group_ad.ad.responsive_display_ad.control_spec.enable_asset_enhancements, ad_group_ad.ad.responsive_display_ad.format_setting, ad_group_ad.ad.text_ad.description1, ad_group_ad.ad.call_ad.business_name, ad_group_ad.ad.expanded_text_ad.headline_part3, ad_group_ad.ad.image_ad.mime_type, ad_group_ad.ad_strength, ad_group_ad.ad.app_ad.youtube_videos, ad_group_ad.ad.image_ad.name, ad_group_ad.ad.call_ad.phone_number_verification_url, ad_group_ad.ad.device_preference, ad_group_ad.ad.legacy_responsive_display_ad.short_headline, ad_group_ad.ad.responsive_display_ad.call_to_action_text, ad_group_ad.ad.shopping_product_ad, ad_group_ad.ad.video_responsive_ad.call_to_actions, ad_group_ad.status, ad_group_ad.ad.legacy_responsive_display_ad.description, ad_group_ad.ad.resource_name, ad_group_ad.ad.responsive_display_ad.square_logo_images, ad_group_ad.ad.url_custom_parameters, ad_group_ad.ad.text_ad.description2, ad_group_ad.ad.video_ad.in_stream.action_button_label, ad_group_ad.ad.app_engagement_ad.descriptions, ad_group_ad.ad.expanded_text_ad.headline_part1, ad_group_ad.ad.id, ad_group_ad.ad.legacy_responsive_display_ad.promo_text, ad_group_ad.ad.app_ad.headlines, ad_group_ad.ad.app_engagement_ad.images, ad_group_ad.ad.local_ad.marketing_images, ad_group_ad.ad.responsive_display_ad.marketing_images, ad_group_ad.ad.call_ad.country_code, ad_group_ad.ad.system_managed_resource_source, ad_group_ad.ad.video_responsive_ad.headlines, ad_group_ad.ad.added_by_google_ads, ad_group_ad.ad.call_ad.description1, ad_group_ad.ad.call_ad.path2, ad_group_ad.ad.video_ad.out_stream.description, ad_group_ad.ad.responsive_display_ad.logo_images, ad_group_ad.ad.responsive_display_ad.main_color, ad_group_ad.ad.type, ad_group_ad.ad_group, ad_group_ad.ad.expanded_text_ad.headline_part2, ad_group_ad.ad.final_urls, ad_group_ad.ad.legacy_responsive_display_ad.allow_flexible_color, ad_group_ad.ad.local_ad.headlines, ad_group_ad.ad.app_engagement_ad.headlines, ad_group_ad.ad.app_engagement_ad.videos, ad_group_ad.ad.expanded_dynamic_search_ad.description2, ad_group_ad.ad.responsive_search_ad.path2, ad_group_ad.ad.text_ad.headline, ad_group_ad.ad.local_ad.call_to_actions, ad_group_ad.ad.shopping_comparison_listing_ad.headline, ad_group_ad.ad.tracking_url_template, ad_group_ad.ad.video_responsive_ad.videos, ad_group_ad.ad.app_ad.images, ad_group_ad.ad.expanded_text_ad.description, ad_group_ad.ad.image_ad.image_url, ad_group_ad.ad.local_ad.path2, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.app_ad.mandatory_ad_text, ad_group_ad.ad.image_ad.preview_pixel_width, ad_group_ad.ad.responsive_display_ad.business_name, ad_group_ad.ad.responsive_display_ad.youtube_videos, ad_group_ad.resource_name, ad_group_ad.ad.call_ad.headline2, ad_group_ad.ad.legacy_responsive_display_ad.accent_color, ad_group_ad.ad.image_ad.pixel_height, ad_group_ad.ad.image_ad.preview_image_url, ad_group_ad.ad.local_ad.logo_images, ad_group_ad.ad.display_upload_ad.display_upload_product_type, ad_group_ad.ad.expanded_text_ad.path2, ad_group_ad.ad.final_url_suffix, ad_group_ad.ad.legacy_responsive_display_ad.business_name, ad_group_ad.ad.call_ad.path1, ad_group_ad.ad.legacy_responsive_display_ad.long_headline, ad_group_ad.ad.responsive_display_ad.promo_text, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.policy_summary.review_status, ad_group_ad.ad.expanded_text_ad.description2, ad_group_ad.ad.final_mobile_urls, ad_group_ad.ad.legacy_app_install_ad, ad_group_ad.ad.local_ad.path1, ad_group_ad.ad.responsive_display_ad.price_prefix, ad_group_ad.policy_summary.approval_status, ad_group_ad.ad.expanded_dynamic_search_ad.description, ad_group_ad.ad.legacy_responsive_display_ad.format_setting, ad_group_ad.ad.video_ad.in_stream.action_headline, ad_group_ad.ad.smart_campaign_ad.descriptions, ad_group_ad.ad.video_responsive_ad.long_headlines, ad_group_ad.ad.legacy_responsive_display_ad.call_to_action_text, ad_group_ad.ad.local_ad.descriptions, ad_group_ad.ad.responsive_display_ad.allow_flexible_color, ad_group_ad.ad.responsive_display_ad.control_spec.enable_autogen_video, ad_group_ad.ad.app_ad.descriptions, ad_group_ad.ad.app_ad.html5_media_bundles, ad_group_ad.ad.responsive_display_ad.descriptions, ad_group_ad.ad.legacy_responsive_display_ad.square_marketing_image, ad_group_ad.ad.responsive_display_ad.long_headline, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.smart_campaign_ad.headlines, ad_group_ad.ad.video_responsive_ad.descriptions, ad_group_ad.ad.expanded_text_ad.path1, ad_group_ad.ad.video_responsive_ad.companion_banners, ad_group_ad.policy_summary.policy_topic_entries, ad_group_ad.ad.image_ad.pixel_width, ad_group_ad.ad.legacy_responsive_display_ad.main_color, ad_group_ad.ad.legacy_responsive_display_ad.marketing_image, ad_group_ad.ad.call_ad.headline1, ad_group_ad.ad.final_app_urls, ad_group_ad.ad.url_collections",
            start_date: "2020-01-01",
          },
        },
        {
          type: "customer",
          name: "customers_performance",
          parameters: {
            fields:
              "customer.currency_code, customer.descriptive_name, customer.time_zone, metrics.active_view_ctr, metrics.active_view_cpm, metrics.active_view_impressions, metrics.active_view_measurability, metrics.active_view_measurable_cost_micros, metrics.active_view_measurable_impressions, metrics.active_view_viewability, metrics.all_conversions_from_interactions_rate, metrics.all_conversions_value, metrics.all_conversions, metrics.average_cpv, metrics.average_cpm, metrics.average_cpe, metrics.average_cpc, metrics.average_cost, metrics.clicks, customer.manager, segments.ad_network_type, segments.date, metrics.content_budget_lost_impression_share, metrics.content_impression_share, metrics.content_rank_lost_impression_share, metrics.conversions, metrics.conversions_value, metrics.conversions_from_interactions_rate, metrics.cost_micros, metrics.cost_per_all_conversions, metrics.cost_per_conversion, metrics.cross_device_conversions, metrics.ctr, metrics.engagements, metrics.engagement_rate, customer.id, metrics.impressions, metrics.interaction_event_types, metrics.interaction_rate, metrics.interactions, customer.auto_tagging_enabled, customer.test_account, metrics.search_budget_lost_impression_share, metrics.search_exact_match_impression_share, metrics.search_impression_share, metrics.search_rank_lost_impression_share, metrics.value_per_all_conversions, metrics.value_per_conversion, metrics.video_view_rate, metrics.video_views, metrics.view_through_conversions",
            start_date: "2020-01-01",
          },
        },
        {
          type: "customer",
          name: "customers",
          parameters: {
            fields:
              "customer.auto_tagging_enabled, customer.call_reporting_setting.call_conversion_action, customer.call_reporting_setting.call_conversion_reporting_enabled, customer.call_reporting_setting.call_reporting_enabled, customer.conversion_tracking_setting.conversion_tracking_id, customer.conversion_tracking_setting.cross_account_conversion_tracking_id, customer.currency_code, customer.descriptive_name, customer.final_url_suffix, customer.has_partners_badge, customer.manager, customer.id, customer.optimization_score, customer.optimization_score_weight, customer.pay_per_conversion_eligibility_failure_reasons, customer.remarketing_setting.google_global_site_tag, customer.resource_name, customer.test_account, customer.time_zone, customer.tracking_url_template",
            start_date: "2020-01-01",
          },
        },
      ],
    },
  ],

  displayName: "Google Ads",
  id: "google_ads",
  collectionTypes: [
    "accessible_bidding_strategy",
    "account_budget",
    "account_budget_proposal",
    "account_link",
    "ad_group",
    "ad_group_ad",
    "ad_group_ad_asset_combination_view",
    "ad_group_ad_asset_view",
    "ad_group_ad_label",
    "ad_group_asset",
    "ad_group_asset_set",
    "ad_group_audience_view",
    "ad_group_bid_modifier",
    "ad_group_criterion",
    "ad_group_criterion_customizer",
    "ad_group_criterion_label",
    "ad_group_criterion_simulation",
    "ad_group_customizer",
    "ad_group_extension_setting",
    "ad_group_feed",
    "ad_group_label",
    "ad_group_simulation",
    "ad_parameter",
    "ad_schedule_view",
    "age_range_view",
    "asset",
    "asset_field_type_view",
    "asset_group",
    "asset_group_asset",
    "asset_group_listing_group_filter",
    "asset_group_product_group_view",
    "asset_group_signal",
    "asset_set",
    "asset_set_asset",
    "asset_set_type_view",
    "audience",
    "batch_job",
    "bidding_data_exclusion",
    "bidding_seasonality_adjustment",
    "bidding_strategy",
    "bidding_strategy_simulation",
    "billing_setup",
    "call_view",
    "campaign",
    "campaign_asset",
    "campaign_asset_set",
    "campaign_audience_view",
    "campaign_bid_modifier",
    "campaign_budget",
    "campaign_conversion_goal",
    "campaign_criterion",
    "campaign_criterion_simulation",
    "campaign_customizer",
    "campaign_draft",
    "campaign_extension_setting",
    "campaign_feed",
    "campaign_group",
    "campaign_label",
    "campaign_shared_set",
    "campaign_simulation",
    "carrier_constant",
    "change_event",
    "change_status",
    "click_view",
    "combined_audience",
    "conversion_action",
    "conversion_custom_variable",
    "conversion_goal_campaign_config",
    "conversion_value_rule",
    "conversion_value_rule_set",
    "currency_constant",
    "custom_audience",
    "custom_conversion_goal",
    "custom_interest",
    "customer",
    "customer_asset",
    "customer_asset_set",
    "customer_client",
    "customer_client_link",
    "customer_conversion_goal",
    "customer_customizer",
    "customer_extension_setting",
    "customer_feed",
    "customer_label",
    "customer_manager_link",
    "customer_negative_criterion",
    "customer_user_access",
    "customer_user_access_invitation",
    "customizer_attribute",
    "detail_placement_view",
    "detailed_demographic",
    "display_keyword_view",
    "distance_view",
    "domain_category",
    "dynamic_search_ads_search_term_view",
    "expanded_landing_page_view",
    "experiment",
    "experiment_arm",
    "extension_feed_item",
    "feed",
    "feed_item",
    "feed_item_set",
    "feed_item_set_link",
    "feed_item_target",
    "feed_mapping",
    "feed_placeholder_view",
    "gender_view",
    "geo_target_constant",
    "geographic_view",
    "group_placement_view",
    "hotel_group_view",
    "hotel_performance_view",
    "hotel_reconciliation",
    "income_range_view",
    "keyword_plan",
    "keyword_plan_ad_group",
    "keyword_plan_ad_group_keyword",
    "keyword_plan_campaign",
    "keyword_plan_campaign_keyword",
    "keyword_theme_constant",
    "keyword_view",
    "label",
    "landing_page_view",
    "language_constant",
    "lead_form_submission_data",
    "life_event",
    "location_view",
    "managed_placement_view",
    "media_file",
    "mobile_app_category_constant",
    "mobile_device_constant",
    "offline_user_data_job",
    "operating_system_version_constant",
    "paid_organic_search_term_view",
    "parental_status_view",
    "per_store_view",
    "product_bidding_category_constant",
    "product_group_view",
    "product_link",
    "qualifying_question",
    "recommendation",
    "remarketing_action",
    "search_term_view",
    "shared_criterion",
    "shared_set",
    "shopping_performance_view",
    "smart_campaign_search_term_view",
    "smart_campaign_setting",
    "third_party_app_analytics_link",
    "topic_constant",
    "topic_view",
    "travel_activity_group_view",
    "travel_activity_performance_view",
    "user_interest",
    "user_list",
    "user_location_view",
    "video",
    "webpage_view",
  ],
  configParameters: [
    ...googleAuthConfigParameters({
      requireSubject: true,
      oauthSecretsRequired: false,
    }),
    {
      displayName: "Customer ID",
      id: "config.customer_id",
      type: stringType,
      required: true,
      documentation: (
        <>
          The client customer ID is the account number of the Google Ads client account you want to pull data from. Pass
          it without '-' symbols.
        </>
      ),
    },
    {
      displayName: "Manager Customer ID",
      id: "config.manager_customer_id",
      type: stringType,
      required: false,
      documentation: (
        <>
          For Google Ads API calls made by a manager to a client account (that is, when logging in as a manager to make
          API calls to one of its client accounts), you also need to supply the Manager Customer Id. This value
          represents the Google Ads customer ID of the manager making the API call. Pass it without '-' symbols.
        </>
      ),
    },
    {
      displayName: "Developer Token",
      id: "config.developer_token",
      type: oauthSecretType,
      required: true,
      documentation: (
        <>
          Standalone Open-Source instances of Jitsu require a special Developer Token to work with Google Ads API.
          <br />
          Please read the official documentation from Google:{" "}
          <a target="_blank" href="https://developers.google.com/google-ads/api/docs/first-call/dev-token">
            Obtain Your Developer Token
          </a>
          <br />
          <br />
          <b>Attention:</b>
          <br />
          Developer Token is an application secret. It must not be exposed to anyone outside of your company.
          <br />
          It is highly recommended to set Developer Token in Jitsu Server config instead of UI form.
          <br />
          <b>as yaml config variable:</b>
          <br />
          <code>google_ads.developer_token: abc123</code>
          <br />
          <b>or as environment variable:</b>
          <br />
          <code>GOOGLE_ADS_DEVELOPER_TOKEN=abc123</code>
          <br />
          <br />
          Cloud Jitsu version has its own embed Developer Token – no extra actions is required.
        </>
      ),
    },
  ],
  documentation: {
    overview: (
      <>
        The Google Ads connector pulls data from{" "}
        <a target="_blank" href="https://developers.google.com/google-ads/api/fields/v8/overview">
          Google Ads API
        </a>
        . The connector is highly configurable.
        <br />
        You can compose any number of reports using{" "}
        <a target="_blank" href="https://developers.google.com/google-ads/api/fields/v8/overview_query_builder">
          Query Builder
        </a>{" "}
        by importing field lists to this source as separate streams.
        <br />
        <h1>Developer Token requirement</h1>
        Standalone Open-Source instances of Jitsu require a special Developer Token to work with Google Ads API.
        <br />
        Please read the official documentation from Google:{" "}
        <a href="https://developers.google.com/google-ads/api/docs/first-call/dev-token" target={"_blank"}>
          Obtain Your Developer Token
        </a>
        <br />
        <br />
        <b>Attention:</b>
        <br />
        Developer Token is an application secret. It must not be exposed to anyone outside of your company.
        <br />
        It is highly recommended to set Developer Token in Jitsu Server config instead of UI form.
        <br />
        <b>as yaml config variable:</b>
        <br />
        <code>google_ads.developer_token: abc123</code>
        <br />
        <b>or as environment variable:</b>
        <br />
        <code>GOOGLE_ADS_DEVELOPER_TOKEN=abc123</code>
        <br />
        <br />
        Cloud Jitsu version has its own embed Developer Token – no extra actions is required.
      </>
    ),
    connection: googleServiceAuthDocumentation({
      oauthEnabled: true,
      serviceAccountEnabled: true,
      scopes: ["https://www.googleapis.com/auth/adwords"],
      serviceName: "Google Ads",
      apis: ["Google Ads API"],
      serviceAccountSpecifics: (
        <>
          <li>Go to "DETAILS" tab</li>
          <li>
            Press "SHOW DOMAIN-WIDE DELEGATION" at the bottom, check{" "}
            <b>Enable Google Workspace Domain-wide Delegation</b> and press "SAVE"{" "}
          </li>
          <li>
            Share the service account ID and the Google Ads API scope (https://www.googleapis.com/auth/adwords) with
            your domain administrator. Request the domain administrator to delegate domain-wide authority to your
            service account.
          </li>
          <li>
            If you are the domain administrator, follow the instructions in the{" "}
            <a target="_blank" href="https://support.google.com/a/answer/162106">
              help center guide
            </a>{" "}
            to complete this step.
          </li>
        </>
      ),
    }),
  },
}

export const googleAnalytics: SourceConnector = {
  pic: (
    <svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 64 64">
      <g transform="matrix(.363638 0 0 .363636 -3.272763 -2.909091)">
        <path
          d="M130 29v132c0 14.77 10.2 23 21 23 10 0 21-7 21-23V30c0-13.54-10-22-21-22s-21 9.33-21 21z"
          fill="#f9ab00"
        />
        <g fill="#e37400">
          <path d="M75 96v65c0 14.77 10.2 23 21 23 10 0 21-7 21-23V97c0-13.54-10-22-21-22s-21 9.33-21 21z" />
          <circle cx="41" cy="163" r="21" />
        </g>
      </g>
    </svg>
  ),
  collectionParameters: [
    {
      displayName: "Dimensions",
      documentation: (
        <>
          <a target="_blank" href="https://ga-dev-tools.appspot.com/dimensions-metrics-explorer/">
            Use this tool to check dimensions compatibility
          </a>
        </>
      ),
      id: "dimensions",
      // prettier-ignore
      type: selectionType(expandGACustom(['ga:userType', 'ga:visitorType', 'ga:sessionCount', 'ga:visitCount', 'ga:daysSinceLastSession',
        'ga:userDefinedValue', 'ga:userBucket', 'ga:sessionDurationBucket', 'ga:visitLength', 'ga:referralPath',
        'ga:fullReferrer', 'ga:campaign', 'ga:source', 'ga:medium', 'ga:sourceMedium', 'ga:keyword',
        'ga:adContent', 'ga:socialNetwork', 'ga:hasSocialSourceReferral', 'ga:adGroup', 'ga:adSlot',
        'ga:adDistributionNetwork', 'ga:adMatchType', 'ga:adKeywordMatchType', 'ga:adMatchedQuery',
        'ga:adPlacementDomain', 'ga:adPlacementUrl', 'ga:adFormat', 'ga:adTargetingType', 'ga:adTargetingOption',
        'ga:adDisplayUrl', 'ga:adDestinationUrl', 'ga:adwordsCustomerID', 'ga:adwordsCampaignID', 'ga:adwordsAdGroupID',
        'ga:adwordsCreativeID', 'ga:adwordsCriteriaID', 'ga:adQueryWordCount', 'ga:goalCompletionLocation',
        'ga:goalPreviousStep1', 'ga:goalPreviousStep2', 'ga:goalPreviousStep3', 'ga:browser', 'ga:browserVersion',
        'ga:operatingSystem', 'ga:operatingSystemVersion', 'ga:mobileDeviceBranding', 'ga:mobileDeviceModel',
        'ga:mobileInputSelector', 'ga:mobileDeviceInfo', 'ga:mobileDeviceMarketingName', 'ga:deviceCategory',
        'ga:continent', 'ga:subContinent', 'ga:country', 'ga:region', 'ga:metro', 'ga:city', 'ga:latitude', 'ga:longitude',
        'ga:networkDomain', 'ga:networkLocation', 'ga:flashVersion', 'ga:javaEnabled', 'ga:language', 'ga:screenColors',
        'ga:sourcePropertyDisplayName', 'ga:sourcePropertyTrackingId', 'ga:screenResolution', 'ga:socialActivityContentUrl',
        'ga:hostname', 'ga:pagePath', 'ga:pagePathLevel1', 'ga:pagePathLevel2', 'ga:pagePathLevel3', 'ga:pagePathLevel4',
        'ga:pageTitle', 'ga:landingPagePath', 'ga:secondPagePath', 'ga:exitPagePath', 'ga:previousPagePath', 'ga:pageDepth',
        'ga:searchUsed', 'ga:searchKeyword', 'ga:searchKeywordRefinement', 'ga:searchCategory', 'ga:searchStartPage',
        'ga:searchDestinationPage', 'ga:searchAfterDestinationPage', 'ga:appInstallerId', 'ga:appVersion', 'ga:appName',
        'ga:appId', 'ga:screenName', 'ga:screenDepth', 'ga:landingScreenName', 'ga:exitScreenName', 'ga:eventCategory', 'ga:eventAction',
        'ga:eventLabel', 'ga:transactionId', 'ga:affiliation', 'ga:sessionsToTransaction', 'ga:visitsToTransaction',
        'ga:daysToTransaction', 'ga:productSku', 'ga:productName', 'ga:productCategory', 'ga:currencyCode',
        'ga:socialInteractionNetwork', 'ga:socialInteractionAction', 'ga:socialInteractionNetworkAction', 'ga:socialInteractionTarget',
        'ga:socialEngagementType', 'ga:userTimingCategory', 'ga:userTimingLabel', 'ga:userTimingVariable', 'ga:exceptionDescription',
        'ga:experimentId', 'ga:experimentVariant', 'ga:dimension1', 'ga:dimension2', 'ga:dimension3', 'ga:dimension4', 'ga:dimension5', 'ga:dimension6'
        , 'ga:dimension7', 'ga:dimension8', 'ga:dimension9', 'ga:dimension10', 'ga:dimension11', 'ga:dimension12', 'ga:dimension13', 'ga:dimension14', 'ga:dimension15'
        , 'ga:dimension16', 'ga:dimension17', 'ga:dimension18', 'ga:dimension19', 'ga:dimension20', 'ga:customVarNameXX', 'ga:customVarValueXX', 'ga:date', 'ga:year',
        'ga:month', 'ga:week', 'ga:day', 'ga:hour', 'ga:minute', 'ga:nthMonth', 'ga:nthWeek', 'ga:nthDay', 'ga:nthMinute',
        'ga:dayOfWeek', 'ga:dayOfWeekName', 'ga:dateHour', 'ga:dateHourMinute', 'ga:yearMonth', 'ga:yearWeek', 'ga:isoWeek',
        'ga:isoYear', 'ga:isoYearIsoWeek', 'ga:dcmClickAd', 'ga:dcmClickAdId', 'ga:dcmClickAdType', 'ga:dcmClickAdTypeId',
        'ga:dcmClickAdvertiser', 'ga:dcmClickAdvertiserId', 'ga:dcmClickCampaign', 'ga:dcmClickCampaignId', 'ga:dcmClickCreativeId',
        'ga:dcmClickCreative', 'ga:dcmClickRenderingId', 'ga:dcmClickCreativeType', 'ga:dcmClickCreativeTypeId', 'ga:dcmClickCreativeVersion',
        'ga:dcmClickSite', 'ga:dcmClickSiteId', 'ga:dcmClickSitePlacement', 'ga:dcmClickSitePlacementId', 'ga:dcmClickSpotId',
        'ga:dcmFloodlightActivity', 'ga:dcmFloodlightActivityAndGroup', 'ga:dcmFloodlightActivityGroup', 'ga:dcmFloodlightActivityGroupId',
        'ga:dcmFloodlightActivityId', 'ga:dcmFloodlightAdvertiserId', 'ga:dcmFloodlightSpotId', 'ga:dcmLastEventAd', 'ga:dcmLastEventAdId',
        'ga:dcmLastEventAdType', 'ga:dcmLastEventAdTypeId', 'ga:dcmLastEventAdvertiser', 'ga:dcmLastEventAdvertiserId',
        'ga:dcmLastEventAttributionType', 'ga:dcmLastEventCampaign', 'ga:dcmLastEventCampaignId', 'ga:dcmLastEventCreativeId',
        'ga:dcmLastEventCreative', 'ga:dcmLastEventRenderingId', 'ga:dcmLastEventCreativeType', 'ga:dcmLastEventCreativeTypeId',
        'ga:dcmLastEventCreativeVersion', 'ga:dcmLastEventSite', 'ga:dcmLastEventSiteId', 'ga:dcmLastEventSitePlacement',
        'ga:dcmLastEventSitePlacementId', 'ga:dcmLastEventSpotId', 'ga:landingContentGroupXX', 'ga:previousContentGroupXX',
        'ga:contentGroupXX', 'ga:userAgeBracket', 'ga:visitorAgeBracket', 'ga:userGender', 'ga:visitorGender', 'ga:interestOtherCategory',
        'ga:interestAffinityCategory', 'ga:interestInMarketCategory', 'ga:dfpLineItemId', 'ga:dfpLineItemName', 'ga:acquisitionCampaign',
        'ga:acquisitionMedium', 'ga:acquisitionSource', 'ga:acquisitionSourceMedium', 'ga:acquisitionTrafficChannel', 'ga:browserSize',
        'ga:campaignCode', 'ga:channelGrouping', 'ga:checkoutOptions', 'ga:cityId', 'ga:cohort', 'ga:cohortNthDay', 'ga:cohortNthMonth',
        'ga:cohortNthWeek', 'ga:continentId', 'ga:countryIsoCode', 'ga:dataSource', 'ga:dbmClickAdvertiser', 'ga:dbmClickAdvertiserId',
        'ga:dbmClickCreativeId', 'ga:dbmClickExchange', 'ga:dbmClickExchangeId', 'ga:dbmClickInsertionOrder', 'ga:dbmClickInsertionOrderId',
        'ga:dbmClickLineItem', 'ga:dbmClickLineItemId', 'ga:dbmClickSite', 'ga:dbmClickSiteId', 'ga:dbmLastEventAdvertiser',
        'ga:dbmLastEventAdvertiserId', 'ga:dbmLastEventCreativeId', 'ga:dbmLastEventExchange', 'ga:dbmLastEventExchangeId',
        'ga:dbmLastEventInsertionOrder', 'ga:dbmLastEventInsertionOrderId', 'ga:dbmLastEventLineItem', 'ga:dbmLastEventLineItemId',
        'ga:dbmLastEventSite', 'ga:dbmLastEventSiteId', 'ga:dsAdGroup', 'ga:dsAdGroupId', 'ga:dsAdvertiser', 'ga:dsAdvertiserId',
        'ga:dsAgency', 'ga:dsAgencyId', 'ga:dsCampaign', 'ga:dsCampaignId', 'ga:dsEngineAccount', 'ga:dsEngineAccountId', 'ga:dsKeyword',
        'ga:dsKeywordId', 'ga:experimentCombination', 'ga:experimentName', 'ga:internalPromotionCreative', 'ga:internalPromotionId',
        'ga:internalPromotionName', 'ga:internalPromotionPosition', 'ga:isTrueViewVideoAd', 'ga:metroId', 'ga:nthHour', 'ga:orderCouponCode',
        'ga:productBrand', 'ga:productCategoryHierarchy', 'ga:productCategoryLevelXX', 'ga:productCouponCode', 'ga:productListName',
        'ga:productListPosition', 'ga:productVariant', 'ga:regionId', 'ga:regionIsoCode', 'ga:shoppingStage', 'ga:subContinentCode']), 7),
    },
    {
      displayName: "Metrics",
      documentation: (
        <>
          <a target="_blank" href="https://ga-dev-tools.appspot.com/dimensions-metrics-explorer/">
            Use this tool to check metrics compatibility
          </a>
        </>
      ),
      id: "metrics",
      // prettier-ignore
      type: selectionType(expandGACustom([
        'ga:users', 'ga:visitors', 'ga:newUsers', 'ga:newVisits', 'ga:percentNewSessions',
        'ga:percentNewVisits', 'ga:1dayUsers', 'ga:7dayUsers', 'ga:14dayUsers', 'ga:28dayUsers',
        'ga:30dayUsers', 'ga:sessions', 'ga:visits', 'ga:bounces', 'ga:bounceRate', 'ga:visitBounceRate',
        'ga:sessionDuration', 'ga:avgSessionDuration', 'ga:organicSearches', 'ga:impressions', 'ga:adClicks',
        'ga:adCost', 'ga:CPM', 'ga:CPC', 'ga:CTR', 'ga:costPerTransaction', 'ga:costPerGoalConversion',
        'ga:costPerConversion', 'ga:RPC', 'ga:ROI', 'ga:margin', 'ga:ROAS', 'ga:goalXXStarts', 'ga:goalStartsAll',
        'ga:goalXXCompletions', 'ga:goalCompletionsAll', 'ga:goalXXValue', 'ga:goalValueAll', 'ga:goalValuePerSession',
        'ga:goalValuePerVisit', 'ga:goalXXConversionRate', 'ga:goalConversionRateAll', 'ga:goalXXAbandons', 'ga:goalAbandonsAll',
        'ga:goalXXAbandonRate', 'ga:goalAbandonRateAll', 'ga:pageValue', 'ga:entrances', 'ga:entranceRate', 'ga:pageviews',
        'ga:pageviewsPerSession', 'ga:pageviewsPerVisit', 'ga:contentGroupUniqueViewsXX', 'ga:uniquePageviews', 'ga:timeOnPage',
        'ga:avgTimeOnPage', 'ga:exits', 'ga:exitRate', 'ga:searchResultViews', 'ga:searchUniques', 'ga:avgSearchResultViews',
        'ga:searchSessions', 'ga:searchVisits', 'ga:percentSessionsWithSearch', 'ga:percentVisitsWithSearch', 'ga:searchDepth',
        'ga:avgSearchDepth', 'ga:searchRefinements', 'ga:percentSearchRefinements', 'ga:searchDuration', 'ga:avgSearchDuration',
        'ga:searchExits', 'ga:searchExitRate', 'ga:searchGoalXXConversionRate', 'ga:searchGoalConversionRateAll',
        'ga:goalValueAllPerSearch', 'ga:pageLoadTime', 'ga:pageLoadSample', 'ga:avgPageLoadTime', 'ga:domainLookupTime',
        'ga:avgDomainLookupTime', 'ga:pageDownloadTime', 'ga:avgPageDownloadTime', 'ga:redirectionTime', 'ga:avgRedirectionTime',
        'ga:serverConnectionTime', 'ga:avgServerConnectionTime', 'ga:serverResponseTime', 'ga:avgServerResponseTime', 'ga:speedMetricsSample',
        'ga:domInteractiveTime', 'ga:avgDomInteractiveTime', 'ga:domContentLoadedTime', 'ga:avgDomContentLoadedTime',
        'ga:domLatencyMetricsSample', 'ga:screenviews', 'ga:uniqueScreenviews', 'ga:uniqueAppviews', 'ga:screenviewsPerSession',
        'ga:timeOnScreen', 'ga:avgScreenviewDuration', 'ga:totalEvents', 'ga:uniqueDimensionCombinations', 'ga:uniqueEvents',
        'ga:eventValue', 'ga:avgEventValue', 'ga:sessionsWithEvent', 'ga:visitsWithEvent', 'ga:eventsPerSessionWithEvent',
        'ga:eventsPerVisitWithEvent', 'ga:transactions', 'ga:transactionsPerSession', 'ga:transactionsPerVisit', 'ga:transactionRevenue',
        'ga:revenuePerTransaction', 'ga:transactionRevenuePerSession', 'ga:transactionRevenuePerVisit', 'ga:transactionShipping',
        'ga:transactionTax', 'ga:totalValue', 'ga:itemQuantity', 'ga:uniquePurchases', 'ga:revenuePerItem', 'ga:itemRevenue',
        'ga:itemsPerPurchase', 'ga:localTransactionRevenue', 'ga:localTransactionShipping', 'ga:localTransactionTax',
        'ga:localItemRevenue', 'ga:socialInteractions', 'ga:uniqueSocialInteractions', 'ga:socialInteractionsPerSession',
        'ga:socialInteractionsPerVisit', 'ga:userTimingValue', 'ga:userTimingSample', 'ga:avgUserTimingValue', 'ga:exceptions',
        'ga:exceptionsPerScreenview', 'ga:fatalExceptions', 'ga:fatalExceptionsPerScreenview', 'ga:metricXX', 'ga:dcmFloodlightQuantity',
        'ga:dcmFloodlightRevenue', 'ga:adsenseRevenue', 'ga:adsenseAdUnitsViewed', 'ga:adsenseAdsViewed', 'ga:adsenseAdsClicks',
        'ga:adsensePageImpressions', 'ga:adsenseCTR', 'ga:adsenseECPM', 'ga:adsenseExits', 'ga:adsenseViewableImpressionPercent',
        'ga:adsenseCoverage', 'ga:totalPublisherImpressions', 'ga:totalPublisherCoverage', 'ga:totalPublisherMonetizedPageviews',
        'ga:totalPublisherImpressionsPerSession', 'ga:totalPublisherViewableImpressionsPercent', 'ga:totalPublisherClicks',
        'ga:totalPublisherCTR', 'ga:totalPublisherRevenue', 'ga:totalPublisherRevenuePer1000Sessions', 'ga:totalPublisherECPM',
        'ga:adxImpressions', 'ga:adxCoverage', 'ga:adxMonetizedPageviews', 'ga:adxImpressionsPerSession', 'ga:adxViewableImpressionsPercent',
        'ga:adxClicks', 'ga:adxCTR', 'ga:adxRevenue', 'ga:adxRevenuePer1000Sessions', 'ga:adxECPM', 'ga:dfpImpressions', 'ga:dfpCoverage',
        'ga:dfpMonetizedPageviews', 'ga:dfpImpressionsPerSession', 'ga:dfpViewableImpressionsPercent', 'ga:dfpClicks', 'ga:dfpCTR',
        'ga:dfpRevenue', 'ga:dfpRevenuePer1000Sessions', 'ga:dfpECPM', 'ga:backfillImpressions', 'ga:backfillCoverage',
        'ga:backfillMonetizedPageviews', 'ga:backfillImpressionsPerSession', 'ga:backfillViewableImpressionsPercent', 'ga:backfillClicks',
        'ga:backfillCTR', 'ga:backfillRevenue', 'ga:backfillRevenuePer1000Sessions', 'ga:backfillECPM', 'ga:buyToDetailRate',
        'ga:cartToDetailRate', 'ga:cohortActiveUsers', 'ga:cohortAppviewsPerUser', 'ga:cohortAppviewsPerUserWithLifetimeCriteria',
        'ga:cohortGoalCompletionsPerUser', 'ga:cohortGoalCompletionsPerUserWithLifetimeCriteria', 'ga:cohortPageviewsPerUser',
        'ga:cohortPageviewsPerUserWithLifetimeCriteria', 'ga:cohortRetentionRate', 'ga:cohortRevenuePerUser',
        'ga:cohortRevenuePerUserWithLifetimeCriteria', 'ga:cohortSessionDurationPerUser', 'ga:cohortSessionDurationPerUserWithLifetimeCriteria',
        'ga:cohortSessionsPerUser', 'ga:cohortSessionsPerUserWithLifetimeCriteria', 'ga:cohortTotalUsers',
        'ga:cohortTotalUsersWithLifetimeCriteria', 'ga:dbmCPA', 'ga:dbmCPC', 'ga:dbmCPM', 'ga:dbmCTR', 'ga:dbmClicks', 'ga:dbmConversions',
        'ga:dbmCost', 'ga:dbmImpressions', 'ga:dbmROAS', 'ga:dcmCPC', 'ga:dcmCTR', 'ga:dcmClicks', 'ga:dcmCost', 'ga:dcmImpressions',
        'ga:dcmMargin', 'ga:dcmROAS', 'ga:dcmRPC', 'ga:dsCPC', 'ga:dsCTR', 'ga:dsClicks', 'ga:dsCost', 'ga:dsImpressions', 'ga:dsProfit',
        'ga:dsReturnOnAdSpend', 'ga:dsRevenuePerClick', 'ga:hits', 'ga:internalPromotionCTR', 'ga:internalPromotionClicks',
        'ga:internalPromotionViews', 'ga:localProductRefundAmount', 'ga:localRefundAmount', 'ga:productAddsToCart', 'ga:productCheckouts',
        'ga:productDetailViews', 'ga:productListCTR', 'ga:productListClicks', 'ga:productListViews', 'ga:productRefundAmount', 'ga:productRefunds',
        'ga:productRemovesFromCart', 'ga:productRevenuePerPurchase', 'ga:quantityAddedToCart', 'ga:quantityCheckedOut', 'ga:quantityRefunded',
        'ga:quantityRemovedFromCart', 'ga:refundAmount', 'ga:revenuePerUser', 'ga:sessionsPerUser', 'ga:totalRefunds', 'ga:transactionsPerUser'
      ]), 10),
    },
  ],
  collectionTemplates: [
    {
      templateName: "Default template",
      description: <></>,
      collections: [
        {
          type: "report",
          name: "daily_active_users",
          parameters: {
            dimensions: ["ga:date"],
            metrics: ["ga:1dayUsers"],
          },
        },
        {
          type: "report",
          name: "devices",
          parameters: {
            dimensions: ["ga:date", "ga:deviceCategory", "ga:operatingSystem", "ga:browser"],
            metrics: [
              "ga:users",
              "ga:newUsers",
              "ga:sessions",
              "ga:sessionsPerUser",
              "ga:avgSessionDuration",
              "ga:pageviews",
              "ga:pageviewsPerSession",
              "ga:avgTimeOnPage",
              "ga:bounceRate",
              "ga:exitRate",
            ],
          },
        },
        {
          type: "report",
          name: "four_weekly_active_users",
          parameters: {
            dimensions: ["ga:date"],
            metrics: ["ga:28dayUsers"],
          },
        },
        {
          type: "report",
          name: "locations",
          parameters: {
            dimensions: [
              "ga:date",
              "ga:continent",
              "ga:subContinent",
              "ga:country",
              "ga:region",
              "ga:metro",
              "ga:city",
            ],
            metrics: [
              "ga:users",
              "ga:newUsers",
              "ga:sessions",
              "ga:sessionsPerUser",
              "ga:avgSessionDuration",
              "ga:pageviews",
              "ga:pageviewsPerSession",
              "ga:avgTimeOnPage",
              "ga:bounceRate",
              "ga:exitRate",
            ],
          },
        },
        {
          type: "report",
          name: "monthly_active_users",
          parameters: {
            dimensions: ["ga:date"],
            metrics: ["ga:30dayUsers"],
          },
        },
        {
          type: "report",
          name: "pages",
          parameters: {
            dimensions: ["ga:date", "ga:hostname", "ga:pagePath"],
            metrics: [
              "ga:pageviews",
              "ga:uniquePageviews",
              "ga:avgTimeOnPage",
              "ga:entrances",
              "ga:entranceRate",
              "ga:bounceRate",
              "ga:exits",
              "ga:exitRate",
            ],
          },
        },
        {
          type: "report",
          name: "traffic_sources",
          parameters: {
            dimensions: ["ga:date", "ga:source", "ga:medium", "ga:socialNetwork"],
            metrics: [
              "ga:users",
              "ga:newUsers",
              "ga:sessions",
              "ga:sessionsPerUser",
              "ga:avgSessionDuration",
              "ga:pageviews",
              "ga:pageviewsPerSession",
              "ga:avgTimeOnPage",
              "ga:bounceRate",
              "ga:exitRate",
            ],
          },
        },
        {
          type: "report",
          name: "two_weekly_active_users",
          parameters: {
            dimensions: ["ga:date"],
            metrics: ["ga:14dayUsers"],
          },
        },
        {
          type: "report",
          name: "website_overview",
          parameters: {
            dimensions: ["ga:date"],
            metrics: [
              "ga:users",
              "ga:newUsers",
              "ga:sessions",
              "ga:sessionsPerUser",
              "ga:avgSessionDuration",
              "ga:pageviews",
              "ga:pageviewsPerSession",
              "ga:avgTimeOnPage",
              "ga:bounceRate",
              "ga:exitRate",
            ],
          },
        },
        {
          type: "report",
          name: "weekly_active_users",
          parameters: {
            dimensions: ["ga:date"],
            metrics: ["ga:7dayUsers"],
          },
        },
      ],
    },
  ],

  displayName: "Google Analytics",
  id: "google_analytics",
  collectionTypes: ["report"],
  configParameters: [
    ...googleAuthConfigParameters({
      oauthSecretsRequired: false,
    }),
    {
      displayName: "View ID",
      id: "config.view_id",
      type: stringType,
      required: true,
      documentation: (
        <>
          Read about{" "}
          <a
            target="_blank"
            href="https://jitsu.com/docs/sources-configuration/google-analytics#how-to-find-google-analytics-view-id"
          >
            how to find Google Analytics View ID
          </a>
        </>
      ),
    },
  ],
  documentation: {
    overview: (
      <>
        The Google Analytics connector pulls data from{" "}
        <a target="_blank" href="https://developers.google.com/analytics/devguides/reporting/core/v4">
          Google Analytics API
        </a>
        . The connector is highly configurable and can be used to pull data from Google Ads too (if Google Analytics
        account is liked to Google Ads). Full list of parameters can be{" "}
        <a target="_blank" href="https://ga-dev-tools.appspot.com/dimensions-metrics-explorer">
          found here
        </a>
      </>
    ),
    connection: googleServiceAuthDocumentation({
      oauthEnabled: true,
      serviceAccountEnabled: true,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      serviceName: "Google Analytics",
      apis: ["Google Analytics API"],
    }),
  },
}

export const googlePlay: SourceConnector = {
  pic: (
    <svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 48 48">
      <path
        fill="#4db6ac"
        d="M7.705,4.043C7.292,4.15,7,4.507,7,5.121c0,1.802,0,18.795,0,18.795S7,42.28,7,43.091c0,0.446,0.197,0.745,0.5,0.856l20.181-20.064L7.705,4.043z"
      />
      <path
        fill="#dce775"
        d="M33.237,18.36l-8.307-4.796c0,0-15.245-8.803-16.141-9.32C8.401,4.02,8.019,3.961,7.705,4.043l19.977,19.84L33.237,18.36z"
      />
      <path
        fill="#d32f2f"
        d="M8.417,43.802c0.532-0.308,15.284-8.825,24.865-14.357l-5.601-5.562L7.5,43.947C7.748,44.038,8.066,44.004,8.417,43.802z"
      />
      <path
        fill="#fbc02d"
        d="M41.398,23.071c-0.796-0.429-8.1-4.676-8.1-4.676l-0.061-0.035l-5.556,5.523l5.601,5.562c4.432-2.559,7.761-4.48,8.059-4.653C42.285,24.248,42.194,23.5,41.398,23.071z"
      />
    </svg>
  ),
  documentation: {
    overview: (
      <>
        The Google Play connector can sync <b>earnings</b> (financial report) and <b>sales</b> (statistics about sales).
      </>
    ),
    connection: googleServiceAuthDocumentation({
      oauthEnabled: true,
      serviceAccountEnabled: true,
      scopes: ["https://www.googleapis.com/auth/devstorage.read_only"],
      serviceName: "Google Play",
      apis: ["Cloud Storage"],
    }),
  },
  displayName: "Google Play",
  id: "google_play",
  collectionTypes: ["earnings", "sales"],
  collectionParameters: [],
  configParameters: [
    {
      displayName: "Bucket ID",
      id: "config.account_id",
      type: stringType,
      required: true,
      documentation: (
        <>
          <b>Google Cloud Storage Bucket ID:</b>
          <br />
          Sign in to your Google Play account.
          <br />
          In the right pane, select the app in the <b>Select an app</b> field.
          <br />
          Scroll to the end of the page to the Direct Report URIs section and copy the Bucket ID.
          <br />
          Your bucket ID begins with <b>pubsite_prod_</b>
          <br />
          For example: pubsite_prod_123456789876543
        </>
      ),
    },
    ...googleAuthConfigParameters({
      oauthSecretsRequired: false,
    }),
  ],
}

export const firebase: SourceConnector = {
  pic: (
    <svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 48 48">
      <path fill="#ff8f00" d="M8,37L23.234,8.436c0.321-0.602,1.189-0.591,1.494,0.02L30,19L8,37z" />
      <path fill="#ffa000" d="M8,36.992l5.546-34.199c0.145-0.895,1.347-1.089,1.767-0.285L26,22.992L8,36.992z" />
      <path fill="#ff6f00" d="M8.008 36.986L8.208 36.829 25.737 22.488 20.793 13.012z" />
      <path
        fill="#ffc400"
        d="M8,37l26.666-25.713c0.559-0.539,1.492-0.221,1.606,0.547L40,37l-15,8.743 c-0.609,0.342-1.352,0.342-1.961,0L8,37z"
      />
    </svg>
  ),
  documentation: {
    overview: <>The Firebase connector can sync users and any collection from the Firestore cloud.</>,
    connection: googleServiceAuthDocumentation({
      oauthEnabled: false,
      serviceAccountEnabled: true,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      serviceName: "Firebase Analytics",
      apis: ["Firebase API"],
    }),
  },
  displayName: "Firebase",
  id: "firebase",
  collectionTypes: ["users", "firestore"],
  collectionParameters: [
    {
      applyOnlyTo: "firestore",
      displayName: "Firestore Collection",
      id: "collection",
      type: stringType,
      required: true,
      documentation: (
        <>
          Firestore collection ID. Can include wildcard for example: 'collection/*/sub_collection' will synchronized
          only sub collections from all objects in 'collection'
        </>
      ),
    },
  ],
  configParameters: [
    ...googleAuthConfigParameters({
      serviceAccountKey: "config.key",
      disableOauth: true,
    }),
    {
      displayName: "Project ID",
      id: "config.project_id",
      type: stringType,
      required: true,
      documentation: <>Firebase Project ID from the Project Settings page.</>,
    },
  ],
}

export const redis: SourceConnector = {
  pic: (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      height="100%"
      width="100%"
      xmlnsXlink="http://www.w3.org/1999/xlink"
    >
      <defs>
        <path
          id="a"
          d="m45.536 38.764c-2.013 1.05-12.44 5.337-14.66 6.494s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276c-1-.478-1.524-.88-1.524-1.26v-3.813s14.447-3.145 16.78-3.982 3.14-.867 5.126-.14 13.853 2.868 15.814 3.587v3.76c0 .377-.452.8-1.477 1.324z"
        />
        <path
          id="b"
          d="m45.536 28.733c-2.013 1.05-12.44 5.337-14.66 6.494s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276-2.04-1.613-.077-2.382l15.332-5.935c2.332-.837 3.14-.867 5.126-.14s12.35 4.853 14.312 5.57 2.037 1.31.024 2.36z"
        />
      </defs>
      <g transform="matrix(.848327 0 0 .848327 -7.883573 -9.449691)">
        <use fill="#a41e11" xlinkHref="#a" />
        <path
          d="m45.536 34.95c-2.013 1.05-12.44 5.337-14.66 6.494s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276-2.04-1.613-.077-2.382l15.332-5.936c2.332-.836 3.14-.867 5.126-.14s12.35 4.852 14.31 5.582 2.037 1.31.024 2.36z"
          fill="#d82c20"
        />
        <use fill="#a41e11" xlinkHref="#a" y="-6.218" />
        <use fill="#d82c20" xlinkHref="#b" />
        <path
          d="m45.536 26.098c-2.013 1.05-12.44 5.337-14.66 6.495s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276c-1-.478-1.524-.88-1.524-1.26v-3.815s14.447-3.145 16.78-3.982 3.14-.867 5.126-.14 13.853 2.868 15.814 3.587v3.76c0 .377-.452.8-1.477 1.324z"
          fill="#a41e11"
        />
        <use fill="#d82c20" xlinkHref="#b" y="-6.449" />
        <g fill="#fff">
          <path d="m29.096 20.712-1.182-1.965-3.774-.34 2.816-1.016-.845-1.56 2.636 1.03 2.486-.814-.672 1.612 2.534.95-3.268.34zm-6.296 3.912 8.74-1.342-2.64 3.872z" />
          <ellipse cx="20.444" cy="21.402" rx="4.672" ry="1.811" />
        </g>
        <path d="m42.132 21.138-5.17 2.042-.004-4.087z" fill="#7a0c00" />
        <path d="m36.963 23.18-.56.22-5.166-2.042 5.723-2.264z" fill="#ad2115" />
      </g>
    </svg>
  ),
  displayName: "Redis",
  id: "redis",
  collectionTypes: [],
  collectionParameters: [
    {
      displayName: "Redis Key Pattern",
      id: "redis_key",
      type: stringType,
      required: true,
      documentation: (
        <>
          Provide a certain Redis key to sync data from or pattern: <b>my_currencies*</b>. Jitsu will search keys by
          pattern and sync them.
        </>
      ),
    },
  ],
  configParameters: [
    {
      displayName: "Redis Host",
      id: "config.host",
      type: stringType,
      required: true,
      documentation: <>Redis host</>,
    },
    {
      displayName: "Redis Port",
      id: "config.port",
      type: intType,
      defaultValue: 6379,
      required: true,
      documentation: <>Redis port</>,
    },
    {
      displayName: "Redis Password",
      id: "config.password",
      type: passwordType,
      documentation: <>Redis password. Leave it empty if your Redis doesn't have a password.</>,
    },
  ],
  documentation: {
    overview: (
      <>
        The Redis connector pulls data from{" "}
        <a target="_blank" href="https://redis.io/commands/get">
          string
        </a>
        ,{" "}
        <a target="_blank" href="https://redis.io/commands/hscan">
          hash
        </a>
        ,{" "}
        <a target="_blank" href="https://redis.io/commands/lrange">
          list
        </a>
        ,{" "}
        <a target="_blank" href="https://redis.io/commands/sscan">
          set
        </a>
        ,{" "}
        <a target="_blank" href="https://redis.io/commands/zscan">
          sorted set
        </a>{" "}
        keys. It works with a certain Redis key configuration as well as key pattern. Jitsu uses{" "}
        <a target="_blank" href="https://redis.io/commands/scan">
          scan
        </a>{" "}
        commands which prevent blocking and doesn't affect Redis performance.
      </>
    ),
    connection: <></>,
  },
}

export const amplitude: SourceConnector = {
  pic: (
    <svg
      id="Layer_1"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      height="100%"
      width="100%"
      x="0px"
      y="0px"
      viewBox="0 0 200 200"
      enableBackground="new 0 0 200 200"
      xmlSpace="preserve"
    >
      <g id="Random-Assignments_2_">
        <g id="Amplitude-logomark" transform="translate(-10.000000, -10.000000)">
          <g id="Amplitude_logomark" transform="translate(10.000000, 10.000000)">
            <path
              id="Shape"
              fill="#00A7CF"
              d="M89.3,50.5c-0.5-0.7-1.1-1-1.7-1c-0.5,0-0.9,0.2-1.3,0.4C81.5,53.7,75,69.6,69.6,90.7l4.8,0.1 c9.4,0.1,19.1,0.2,28.7,0.4c-2.5-9.6-4.9-17.9-7.1-24.5C92.7,56.8,90.6,52.5,89.3,50.5z"
            />
            <path
              id="Shape_1_"
              fill="#00A7CF"
              d="M100,10c-49.7,0-90,40.3-90,90s40.3,90,90,90s90-40.3,90-90S149.7,10,100,10z M164.7,101.6 L164.7,101.6c-0.1,0.1-0.2,0.2-0.3,0.2l-0.1,0.1c-0.1,0-0.1,0.1-0.2,0.1c-0.1,0-0.1,0.1-0.2,0.1l0,0c-0.7,0.4-1.4,0.5-2.2,0.5 H119c0.3,1.4,0.7,3,1.1,4.8c2.3,10.1,8.5,36.9,15.1,36.9h0.1h0.1h0.1c5.1,0,7.8-7.4,13.5-23.8l0.1-0.2c0.9-2.6,2-5.6,3.1-8.7 l0.3-0.8l0,0c0.4-1,1.5-1.5,2.5-1.1c1,0.3,1.6,1.4,1.4,2.4l0,0l-0.2,0.8c-0.6,1.9-1.2,4.6-2,7.6c-3.4,14.2-8.6,35.7-21.9,35.7 h-0.1c-8.6-0.1-13.7-13.8-15.9-19.7c-4.1-11-7.2-22.7-10.2-34H66.9l-8.1,26.1l-0.1-0.1c-1,1.6-2.9,2.3-4.6,1.8s-3-2.1-3-4v-0.1 l0.5-2.9c1.1-6.7,2.5-13.7,4-20.7H38.9l-0.1-0.1c-3.1-0.5-5.3-3.1-5.3-6.2c0-3,2.1-5.6,5.1-6.1c0.6-0.1,1.3-0.1,1.9-0.1h0.8 c5.3,0.1,10.8,0.2,16.9,0.3c8.7-35.1,18.7-53,29.8-53c11.9,0,20.8,27.2,27.9,53.7l0,0.1c14.5,0.3,30.1,0.7,45.1,1.8l0.6,0.1 c0.2,0,0.5,0,0.7,0.1h0.1l0.1,0h0c1.8,0.4,3.3,1.7,3.7,3.5C166.8,98.6,166.2,100.5,164.7,101.6z"
            />
          </g>
        </g>
      </g>
    </svg>
  ),
  documentation: {
    overview: (
      <>
        The Amplitude connector pulls data from{" "}
        <a target="_blank" href="https://developers.amplitude.com/docs/http-api-v2">
          Amplitude API
        </a>
        . The connector can sync <b>active users</b>, <b>new users</b>, <b>annotations</b>, <b>average sessions</b>,{" "}
        <b>cohorts</b> and <b>events</b>.
      </>
    ),
    connection: (
      <>
        <ul>
          <li>
            Go to the{" "}
            <a target="_blank" href="https://analytics.amplitude.com/">
              Amplitude Project settings
            </a>{" "}
            page
          </li>
          <li>
            Save API Key and Secret Key value. It is used as API Secret in Jitsu UI. Only Amplitude Admins and Managers
            can view API credentials on Amplitude project settings page.
          </li>
        </ul>
      </>
    ),
  },
  displayName: "Amplitude",
  id: "amplitude",
  collectionTypes: ["active_users", "annotations", "average_sessions", "cohorts", "events", "new_users"],
  configParameters: [
    {
      displayName: "API Key",
      id: "config.api_key",
      type: stringType,
      required: true,
      documentation: (
        <>Amplitude API Key from project settings page. Only Amplitude Admins and Managers can view the API Key.</>
      ),
    },
    {
      displayName: "Secret Key",
      id: "config.secret_key",
      type: stringType,
      required: true,
      documentation: (
        <>
          Amplitude Secret Key from project settings page. Only Amplitude Admins and Managers can view the Secret Key.
        </>
      ),
    },
    {
      displayName: "API Server",
      id: "config.server",
      type: stringType,
      required: false,
      documentation: (
        <>
          Alternative Amplitude server hostname
          <br />
          For project with EU data residency set:
          <br />
          <code>https://analytics.eu.amplitude.com</code>
        </>
      ),
    },
  ],
  collectionParameters: [],
}

export const allNativeConnectors = [facebook, redis, firebase, googleAds, googleAnalytics, googlePlay, amplitude]

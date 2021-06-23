import { intType, jsonType, Parameter, passwordType, selectionType, SourceConnector, stringType } from '../types';
import * as React from 'react';
import { googleServiceAuthDocumentation } from '../lib/documentation';

import { googleAuthConfigParameters } from '../lib/commonParams';

export const facebook: SourceConnector = {
  pic: <svg viewBox="0 0 36 36" fill="url(#gradient)">
    <defs>
      <linearGradient x1="50%" x2="50%" y1="97.0782153%" y2="0%" id="gradient">
        <stop offset="0%" stopColor="#0062E0"/>
        <stop offset="100%" stopColor="#19AFFF"/>
      </linearGradient>
    </defs>
    <path d="M15 35.8C6.5 34.3 0 26.9 0 18 0 8.1 8.1 0 18 0s18 8.1 18 18c0 8.9-6.5 16.3-15 17.8l-1-.8h-4l-1 .8z"/>
    <path fill="white" d="M25 23l.8-5H21v-3.5c0-1.4.5-2.5 2.7-2.5H26V7.4c-1.3-.2-2.7-.4-4-.4-4.1 0-7 2.5-7 7v4h-4.5v5H15v12.7c1 .2 2 .3 3 .3s2-.1 3-.3V23h4z"/>
  </svg>,
  collectionParameters: [
    {
      applyOnlyTo: 'ads',
      displayName: 'Report Fields',
      id: 'fields',
      type: selectionType(['bid_amount', 'adlabels', 'creative', 'status', 'created_time', 'updated_time', 'targeting', 'effective_status', 'campaign_id', 'adset_id', 'conversion_specs', 'recommendations', 'id', 'bid_info', 'last_updated_by_app_id', 'tracking_specs', 'bid_type', 'name', 'account_id', 'source_ad_id']),
      required: true
    },
    {
      applyOnlyTo: 'insights',
      displayName: 'Report Fields',
      id: 'fields',
      type: selectionType(['account_currency', 'account_id', 'account_name', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'objective', 'buying_type', 'cpc', 'cpm', 'cpp', 'ctr', 'estimated_ad_recall_rate', 'estimated_ad_recallers', 'reach', 'unique_clicks', 'unique_ctr', 'frequency', 'actions', 'conversions', 'spend', 'impressions']),
      required: true
    },
    {
      displayName: 'Level of data',
      id: 'level',
      defaultValue: 'ad',
      type: selectionType(['ad', 'adset', 'campaign', 'account'], 1),
      documentation:
        <>
          One of [ad, adset, campaign, account]. <a href="https://developers.facebook.com/docs/marketing-api/reference/adgroup/insights/">Read more about level</a>
        </>
    }

  ],
  displayName: 'Facebook Marketing',
  id: 'facebook_marketing',
  collectionTypes: ['insights', 'ads'],
  configParameters: [
    {
      displayName: 'Account ID',
      id: 'config.account_id',
      type: stringType,
      required: true,
      documentation: <>
        <a target="_blank" href="https://www.facebook.com/business/help/1492627900875762" rel="noreferrer">How to get Facebook Account ID</a>
      </>
    },
    {
      displayName: 'Access Token',
      id: 'config.access_token',
      type: stringType,
      required: true,
      documentation: <>
        <a target="_blank" href="https://developers.facebook.com/docs/pages/access-tokens/#get-a-long-lived-user-access-token" rel="noreferrer">How
          to get Facebook Access Token</a>
      </>
    }
  ]
}

export const googleAnalytics: SourceConnector = {
  pic: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <g transform="matrix(.363638 0 0 .363636 -3.272763 -2.909091)">
      <path d="M130 29v132c0 14.77 10.2 23 21 23 10 0 21-7 21-23V30c0-13.54-10-22-21-22s-21 9.33-21 21z" fill="#f9ab00"/>
      <g fill="#e37400">
        <path d="M75 96v65c0 14.77 10.2 23 21 23 10 0 21-7 21-23V97c0-13.54-10-22-21-22s-21 9.33-21 21z"/>
        <circle cx="41" cy="163" r="21"/>
      </g>
    </g>
  </svg>,
  collectionParameters: [
    {
      displayName: 'Dimensions',
      documentation: <><a href="https://ga-dev-tools.appspot.com/dimensions-metrics-explorer/">Use this tool to check dimensions compatibility</a></>,
      id: 'dimensions',
      type: selectionType(['ga:userType', 'ga:visitorType', 'ga:sessionCount', 'ga:visitCount', 'ga:daysSinceLastSession',
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
        'ga:experimentId', 'ga:experimentVariant', 'ga:dimensionXX', 'ga:customVarNameXX', 'ga:customVarValueXX', 'ga:date', 'ga:year',
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
        'ga:productListPosition', 'ga:productVariant', 'ga:regionId', 'ga:regionIsoCode', 'ga:shoppingStage', 'ga:subContinentCode'], 7)
    },
    {
      displayName: 'Metrics',
      documentation: <><a href="https://ga-dev-tools.appspot.com/dimensions-metrics-explorer/">Use this tool to check metrics compatibility</a></>,
      id: 'metrics',
      type: selectionType([
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
      ], 10)
    }
  ],
  collectionTemplates: [
    {
      templateName: 'Acquisition Overview',
      collectionName: 'report',
      config: {
        dimensions: [
          'ga:date',
          'ga:acquisitionMedium',
          'ga:acquisitionSource',
          'ga:acquisitionSourceMedium',
          'ga:acquisitionTrafficChannel'
        ],
        metrics: [
          'ga:avgSessionDuration',
          'ga:bounceRate',
          'ga:pageviewsPerSession',
          'ga:sessions'
        ]
      }
    }
  ],

  displayName: 'Google Analytics',
  id: 'google_analytics',
  collectionTypes: ['report'],
  configParameters: [
    ...googleAuthConfigParameters({}),
    {
      displayName: 'View ID',
      id: 'config.view_id',
      type: stringType,
      required: true,
      documentation:
          <>
            Read about <a href="https://jitsu.com/docs/sources-configuration/google-analytics#how-to-find-google-analytics-view-id">how to find Google Analytics View ID</a>
          </>
    }
  ],
  documentation: {
    overview: <>The Google Analytics connector pulls data from <a href="https://developers.google.com/analytics/devguides/reporting/core/v4">Google Analytics API</a>. The connector
      is  highly configurable and can be used to pull data from Google Ads too (if Google Analytics account is liked to Google Ads). Full list of parameters can be <a href="https://ga-dev-tools.appspot.com/dimensions-metrics-explorer">found here</a>
    </>,
    connection: googleServiceAuthDocumentation({
      oauthEnabled: true,
      serviceAccountEnabled: true,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      serviceName: 'Google Analytics',
      apis: ['Google Analytics API']
    })
  }
}

export const googlePlay: SourceConnector = {
  pic: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <path fill="#4db6ac" d="M7.705,4.043C7.292,4.15,7,4.507,7,5.121c0,1.802,0,18.795,0,18.795S7,42.28,7,43.091c0,0.446,0.197,0.745,0.5,0.856l20.181-20.064L7.705,4.043z"/>
    <path fill="#dce775" d="M33.237,18.36l-8.307-4.796c0,0-15.245-8.803-16.141-9.32C8.401,4.02,8.019,3.961,7.705,4.043l19.977,19.84L33.237,18.36z"/>
    <path fill="#d32f2f" d="M8.417,43.802c0.532-0.308,15.284-8.825,24.865-14.357l-5.601-5.562L7.5,43.947C7.748,44.038,8.066,44.004,8.417,43.802z"/>
    <path fill="#fbc02d" d="M41.398,23.071c-0.796-0.429-8.1-4.676-8.1-4.676l-0.061-0.035l-5.556,5.523l5.601,5.562c4.432-2.559,7.761-4.48,8.059-4.653C42.285,24.248,42.194,23.5,41.398,23.071z"/>
  </svg>,
  displayName: 'Google Play',
  id: 'google_play',
  collectionTypes: ['earnings', 'sales'],
  collectionParameters: [],
  configParameters: [
    {
      displayName: 'Account ID',
      id: 'config.account_id',
      type: stringType,
      required: true,
      documentation:
        <>
          Identifier of Google Play account
        </>
    },
    ...googleAuthConfigParameters({})
  ]
}

export const firebase: SourceConnector = {
  pic: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <path fill="#ff8f00" d="M8,37L23.234,8.436c0.321-0.602,1.189-0.591,1.494,0.02L30,19L8,37z"/>
    <path fill="#ffa000" d="M8,36.992l5.546-34.199c0.145-0.895,1.347-1.089,1.767-0.285L26,22.992L8,36.992z"/>
    <path fill="#ff6f00" d="M8.008 36.986L8.208 36.829 25.737 22.488 20.793 13.012z"/>
    <path fill="#ffc400" d="M8,37l26.666-25.713c0.559-0.539,1.492-0.221,1.606,0.547L40,37l-15,8.743 c-0.609,0.342-1.352,0.342-1.961,0L8,37z"/>
  </svg>,
  displayName: 'Firebase',
  id: 'firebase',
  collectionTypes: ['users', 'firestore'],
  collectionParameters: [
    {
      applyOnlyTo: 'firestore',
      displayName: 'Firestore Collection',
      id: 'collection',
      type: stringType,
      required: true
    }
  ],
  configParameters: [
    ...googleAuthConfigParameters({ serviceAccountKey: 'config.key', disableOauth: true }),
    {
      displayName: 'Project ID',
      id: 'config.project_id',
      type: stringType,
      required: true
    }
  ]
}

export const redis: SourceConnector = {
  pic:
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink">
      <defs>
        <path id="a"
          d="m45.536 38.764c-2.013 1.05-12.44 5.337-14.66 6.494s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276c-1-.478-1.524-.88-1.524-1.26v-3.813s14.447-3.145 16.78-3.982 3.14-.867 5.126-.14 13.853 2.868 15.814 3.587v3.76c0 .377-.452.8-1.477 1.324z"/>
        <path id="b"
          d="m45.536 28.733c-2.013 1.05-12.44 5.337-14.66 6.494s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276-2.04-1.613-.077-2.382l15.332-5.935c2.332-.837 3.14-.867 5.126-.14s12.35 4.853 14.312 5.57 2.037 1.31.024 2.36z"/>
      </defs>
      <g transform="matrix(.848327 0 0 .848327 -7.883573 -9.449691)">
        <use fill="#a41e11" xlinkHref="#a"/>
        <path
          d="m45.536 34.95c-2.013 1.05-12.44 5.337-14.66 6.494s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276-2.04-1.613-.077-2.382l15.332-5.936c2.332-.836 3.14-.867 5.126-.14s12.35 4.852 14.31 5.582 2.037 1.31.024 2.36z"
          fill="#d82c20"/>
        <use fill="#a41e11" xlinkHref="#a" y="-6.218"/>
        <use fill="#d82c20" xlinkHref="#b"/>
        <path
          d="m45.536 26.098c-2.013 1.05-12.44 5.337-14.66 6.495s-3.453 1.146-5.207.308-12.85-5.32-14.85-6.276c-1-.478-1.524-.88-1.524-1.26v-3.815s14.447-3.145 16.78-3.982 3.14-.867 5.126-.14 13.853 2.868 15.814 3.587v3.76c0 .377-.452.8-1.477 1.324z"
          fill="#a41e11"/>
        <use fill="#d82c20" xlinkHref="#b" y="-6.449"/>
        <g fill="#fff">
          <path d="m29.096 20.712-1.182-1.965-3.774-.34 2.816-1.016-.845-1.56 2.636 1.03 2.486-.814-.672 1.612 2.534.95-3.268.34zm-6.296 3.912 8.74-1.342-2.64 3.872z"/>
          <ellipse cx="20.444" cy="21.402" rx="4.672" ry="1.811"/>
        </g>
        <path d="m42.132 21.138-5.17 2.042-.004-4.087z" fill="#7a0c00"/>
        <path d="m36.963 23.18-.56.22-5.166-2.042 5.723-2.264z" fill="#ad2115"/>
      </g>
    </svg>,
  displayName: 'Redis',
  id: 'redis',
  collectionTypes: [],
  collectionParameters: [
    {
      displayName: 'Redis Key Pattern',
      id: 'redis_key',
      type: stringType,
      required: true,
      documentation: <>
        Provide a certain Redis key to sync data from or pattern: <b>my_currencies*</b>. Jitsu will search keys by pattern
        and sync them.
      </>
    }
  ],
  configParameters: [
    {
      displayName: 'Redis Host',
      id: 'config.host',
      type: stringType,
      required: true
    },
    {
      displayName: 'Redis Port',
      id: 'config.port',
      type: intType,
      defaultValue: 6379,
      required: true
    },
    {
      displayName: 'Redis Password',
      id: 'config.password',
      type: passwordType
    }
  ],
  documentation: {
    overview: <>The Redis connector pulls data from <a href="https://redis.io/commands/get">string</a>, <a href="https://redis.io/commands/hscan">hash</a>, <a href="https://redis.io/commands/lrange">list</a>, <a href="https://redis.io/commands/sscan">set</a>, <a href="https://redis.io/commands/zscan">sorted set</a> keys.
      It works with a certain Redis key configuration as well as key pattern.
      Jitsu uses <a href="https://redis.io/commands/scan">scan</a> commands which prevent blocking and doesn't affect Redis performance.
    </>,
    connection: <></>
  }
}

export const allNativeConnectors = [facebook, redis, firebase, googleAnalytics, googlePlay];

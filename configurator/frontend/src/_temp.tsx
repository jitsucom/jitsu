import React, {ReactNode} from 'react';

/**
 * Type of parameter
 */
export interface ParameterType<T> {
    /**
     * Unique name of the type
     */
    typeName: string;
    /**
     * Additional parameters (for selects - list of options)
     */
    data?: T;
}

export const stringType: ParameterType<string> = {
    typeName: 'string'
};

export const intType: ParameterType<bigint> = {
    typeName: 'int'
};

export const jsonType: ParameterType<string> = {
    typeName: 'json'
};

export const yamlType: ParameterType<string> = {
    typeName: 'yaml'
};

/**
 * YYYY-MM-DD
 */
export const dashDateType: ParameterType<string> = {
    typeName: 'dashDate'
};

export interface SelectOption {
    id: string;
    displayName: string;
}

export interface SelectOptionCollection {
    options: SelectOption[];
    /**
     * Maximum options allowed to be selected
     */
    maxOptions: number;
}

export const selectionType = (options: string[], maxOptions: number = 1): ParameterType<SelectOptionCollection> => {
    return {
        data: {
            options: options.map((id) => ({displayName: id, id: id})),
            maxOptions
        },
        typeName: 'selection'
    };
};

export type Parameter = {
    /**
     * Display name (for UI)
     */
    displayName: string;
    /**
     * Id (corresponds to key in yaml config)
     */
    id: string;
    /**
     * Type of parameter
     */
    type: ParameterType<any>;

    /**
     *  Flag describes required/optional nature of the field. IF empty - field is optional
     */
    required?: boolean;

    /**
     * Documentation
     */
    documentation?: ReactNode;

    /**
     * If not undefined: the parameter should not be configurable at all (hidden from UI) and
     * it's value should be always constant
     */
    constant?: any;
};

export interface CollectionParameter extends Parameter {
    /**
     * If defined, should be applied only to specific collections
     * (see SourceConnector.collectionTypes)
     */
    applyOnlyTo?: string[] | string;
}

export interface SourceConnector {
    /**
     * Name of connector that should be displayed
     */
    displayName: string;
    /**
     * id of connector. Corresponds to 'type' node in event native config
     */
    id: string;
    /**
     * SVG icon (please, no height/width params!)
     */
    pic: ReactNode;
    /**
     * Parameters of each collection
     */
    collectionParameters: CollectionParameter[];
    /**
     * Configuration parameters
     */
    configParameters: Parameter[];

    /**
     * If collections are limited to certain names, list them here
     */
    collectionTypes: string[];

    description?: ReactNode;
}

const facebook: SourceConnector = {
    pic: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
            <path
                d="M25,3C12.85,3,3,12.85,3,25c0,11.03,8.125,20.137,18.712,21.728V30.831h-5.443v-5.783h5.443v-3.848 c0-6.371,3.104-9.168,8.399-9.168c2.536,0,3.877,0.188,4.512,0.274v5.048h-3.612c-2.248,0-3.033,2.131-3.033,4.533v3.161h6.588 l-0.894,5.783h-5.694v15.944C38.716,45.318,47,36.137,47,25C47,12.85,37.15,3,25,3z"/>
        </svg>
    ),
    collectionParameters: [
        {
            applyOnlyTo: 'ads',
            displayName: 'Report Fields',
            id: 'fields',
            type: selectionType([
                'bid_amount',
                'adlabels',
                'creative',
                'status',
                'created_time',
                'updated_time',
                'targeting',
                'effective_status',
                'campaign_id',
                'adset_id',
                'conversion_specs',
                'recommendations',
                'id',
                'bid_info',
                'last_updated_by_app_id',
                'tracking_specs',
                'bid_type',
                'name',
                'account_id',
                'source_ad_id'
            ]),
            required: true
        },
        {
            applyOnlyTo: 'insights',
            displayName: 'Report Fields',
            id: 'fields',
            type: selectionType([
                'account_currency',
                'account_id',
                'account_name',
                'ad_id',
                'ad_name',
                'adset_id',
                'adset_name',
                'campaign_id',
                'campaign_name',
                'objective',
                'buying_type',
                'cpc',
                'cpm',
                'cpp',
                'ctr',
                'estimated_ad_recall_rate',
                'estimated_ad_recallers',
                'reach',
                'unique_clicks',
                'unique_ctr',
                'frequency',
                'actions',
                'conversions',
                'spend',
                'impressions'
            ]),
            required: true
        },
        {
            displayName: 'Level of data',
            id: 'level',
            type: selectionType([
                'account_currency',
                'account_id',
                'account_name',
                'ad_id',
                'ad_name',
                'adset_id',
                'adset_name',
                'campaign_id',
                'campaign_name',
                'objective',
                'buying_type',
                'cpc',
                'cpm',
                'cpp',
                'ctr',
                'estimated_ad_recall_rate',
                'estimated_ad_recallers',
                'reach',
                'unique_clicks',
                'unique_ctr',
                'frequency',
                'actions',
                'conversions',
                'spend',
                'impressions'
            ]),
            documentation: (
                <>
                    One of [ad, adset, campaign, account].{' '}
                    <a href="https://developers.facebook.com/docs/marketing-api/reference/adgroup/insights/">
                        Read more about level
                    </a>
                </>
            )
        }
    ],
    displayName: 'Facebook Marketing',
    id: 'facebook_marketing',
    collectionTypes: ['insights', 'ads'],
    configParameters: [
        {
            displayName: 'Account ID',
            id: 'account_id',
            type: stringType,
            required: true,
            documentation: (
                <>
                    <a target="_blank" href="https://www.facebook.com/business/help/1492627900875762" rel="noreferrer">
                        How to get Facebook Account ID
                    </a>
                </>
            )
        },
        {
            displayName: 'Access Token',
            id: 'access_token',
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
            )
        }
    ]
};

const googleAnalytics: SourceConnector = {
    pic: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
            <g transform="matrix(.363638 0 0 .363636 -3.272763 -2.909091)">
                <path
                    d="M130 29v132c0 14.77 10.2 23 21 23 10 0 21-7 21-23V30c0-13.54-10-22-21-22s-21 9.33-21 21z"
                    fill="#f9ab00"
                />
                <g fill="#e37400">
                    <path d="M75 96v65c0 14.77 10.2 23 21 23 10 0 21-7 21-23V97c0-13.54-10-22-21-22s-21 9.33-21 21z"/>
                    <circle cx="41" cy="163" r="21"/>
                </g>
            </g>
        </svg>
    ),
    collectionParameters: [
        {
            displayName: 'Dimensions',
            id: 'dimensions',
            type: selectionType(
                [
                    'ga:userType',
                    'ga:visitorType',
                    'ga:sessionCount',
                    'ga:visitCount',
                    'ga:daysSinceLastSession',
                    'ga:userDefinedValue',
                    'ga:userBucket',
                    'ga:sessionDurationBucket',
                    'ga:visitLength',
                    'ga:referralPath',
                    'ga:fullReferrer',
                    'ga:campaign',
                    'ga:source',
                    'ga:medium',
                    'ga:sourceMedium',
                    'ga:keyword',
                    'ga:adContent',
                    'ga:socialNetwork',
                    'ga:hasSocialSourceReferral',
                    'ga:adGroup',
                    'ga:adSlot',
                    'ga:adDistributionNetwork',
                    'ga:adMatchType',
                    'ga:adKeywordMatchType',
                    'ga:adMatchedQuery',
                    'ga:adPlacementDomain',
                    'ga:adPlacementUrl',
                    'ga:adFormat',
                    'ga:adTargetingType',
                    'ga:adTargetingOption',
                    'ga:adDisplayUrl',
                    'ga:adDestinationUrl',
                    'ga:adwordsCustomerID',
                    'ga:adwordsCampaignID',
                    'ga:adwordsAdGroupID',
                    'ga:adwordsCreativeID',
                    'ga:adwordsCriteriaID',
                    'ga:adQueryWordCount',
                    'ga:goalCompletionLocation',
                    'ga:goalPreviousStep1',
                    'ga:goalPreviousStep2',
                    'ga:goalPreviousStep3',
                    'ga:browser',
                    'ga:browserVersion',
                    'ga:operatingSystem',
                    'ga:operatingSystemVersion',
                    'ga:mobileDeviceBranding',
                    'ga:mobileDeviceModel',
                    'ga:mobileInputSelector',
                    'ga:mobileDeviceInfo',
                    'ga:mobileDeviceMarketingName',
                    'ga:deviceCategory',
                    'ga:continent',
                    'ga:subContinent',
                    'ga:country',
                    'ga:region',
                    'ga:metro',
                    'ga:city',
                    'ga:latitude',
                    'ga:longitude',
                    'ga:networkDomain',
                    'ga:networkLocation',
                    'ga:flashVersion',
                    'ga:javaEnabled',
                    'ga:language',
                    'ga:screenColors',
                    'ga:sourcePropertyDisplayName',
                    'ga:sourcePropertyTrackingId',
                    'ga:screenResolution',
                    'ga:socialActivityContentUrl',
                    'ga:hostname',
                    'ga:pagePath',
                    'ga:pagePathLevel1',
                    'ga:pagePathLevel2',
                    'ga:pagePathLevel3',
                    'ga:pagePathLevel4',
                    'ga:pageTitle',
                    'ga:landingPagePath',
                    'ga:secondPagePath',
                    'ga:exitPagePath',
                    'ga:previousPagePath',
                    'ga:pageDepth',
                    'ga:searchUsed',
                    'ga:searchKeyword',
                    'ga:searchKeywordRefinement',
                    'ga:searchCategory',
                    'ga:searchStartPage',
                    'ga:searchDestinationPage',
                    'ga:searchAfterDestinationPage',
                    'ga:appInstallerId',
                    'ga:appVersion',
                    'ga:appName',
                    'ga:appId',
                    'ga:screenName',
                    'ga:screenDepth',
                    'ga:landingScreenName',
                    'ga:exitScreenName',
                    'ga:eventCategory',
                    'ga:eventAction',
                    'ga:eventLabel',
                    'ga:transactionId',
                    'ga:affiliation',
                    'ga:sessionsToTransaction',
                    'ga:visitsToTransaction',
                    'ga:daysToTransaction',
                    'ga:productSku',
                    'ga:productName',
                    'ga:productCategory',
                    'ga:currencyCode',
                    'ga:socialInteractionNetwork',
                    'ga:socialInteractionAction',
                    'ga:socialInteractionNetworkAction',
                    'ga:socialInteractionTarget',
                    'ga:socialEngagementType',
                    'ga:userTimingCategory',
                    'ga:userTimingLabel',
                    'ga:userTimingVariable',
                    'ga:exceptionDescription',
                    'ga:experimentId',
                    'ga:experimentVariant',
                    'ga:dimensionXX',
                    'ga:customVarNameXX',
                    'ga:customVarValueXX',
                    'ga:date',
                    'ga:year',
                    'ga:month',
                    'ga:week',
                    'ga:day',
                    'ga:hour',
                    'ga:minute',
                    'ga:nthMonth',
                    'ga:nthWeek',
                    'ga:nthDay',
                    'ga:nthMinute',
                    'ga:dayOfWeek',
                    'ga:dayOfWeekName',
                    'ga:dateHour',
                    'ga:dateHourMinute',
                    'ga:yearMonth',
                    'ga:yearWeek',
                    'ga:isoWeek',
                    'ga:isoYear',
                    'ga:isoYearIsoWeek',
                    'ga:dcmClickAd',
                    'ga:dcmClickAdId',
                    'ga:dcmClickAdType',
                    'ga:dcmClickAdTypeId',
                    'ga:dcmClickAdvertiser',
                    'ga:dcmClickAdvertiserId',
                    'ga:dcmClickCampaign',
                    'ga:dcmClickCampaignId',
                    'ga:dcmClickCreativeId',
                    'ga:dcmClickCreative',
                    'ga:dcmClickRenderingId',
                    'ga:dcmClickCreativeType',
                    'ga:dcmClickCreativeTypeId',
                    'ga:dcmClickCreativeVersion',
                    'ga:dcmClickSite',
                    'ga:dcmClickSiteId',
                    'ga:dcmClickSitePlacement',
                    'ga:dcmClickSitePlacementId',
                    'ga:dcmClickSpotId',
                    'ga:dcmFloodlightActivity',
                    'ga:dcmFloodlightActivityAndGroup',
                    'ga:dcmFloodlightActivityGroup',
                    'ga:dcmFloodlightActivityGroupId',
                    'ga:dcmFloodlightActivityId',
                    'ga:dcmFloodlightAdvertiserId',
                    'ga:dcmFloodlightSpotId',
                    'ga:dcmLastEventAd',
                    'ga:dcmLastEventAdId',
                    'ga:dcmLastEventAdType',
                    'ga:dcmLastEventAdTypeId',
                    'ga:dcmLastEventAdvertiser',
                    'ga:dcmLastEventAdvertiserId',
                    'ga:dcmLastEventAttributionType',
                    'ga:dcmLastEventCampaign',
                    'ga:dcmLastEventCampaignId',
                    'ga:dcmLastEventCreativeId',
                    'ga:dcmLastEventCreative',
                    'ga:dcmLastEventRenderingId',
                    'ga:dcmLastEventCreativeType',
                    'ga:dcmLastEventCreativeTypeId',
                    'ga:dcmLastEventCreativeVersion',
                    'ga:dcmLastEventSite',
                    'ga:dcmLastEventSiteId',
                    'ga:dcmLastEventSitePlacement',
                    'ga:dcmLastEventSitePlacementId',
                    'ga:dcmLastEventSpotId',
                    'ga:landingContentGroupXX',
                    'ga:previousContentGroupXX',
                    'ga:contentGroupXX',
                    'ga:userAgeBracket',
                    'ga:visitorAgeBracket',
                    'ga:userGender',
                    'ga:visitorGender',
                    'ga:interestOtherCategory',
                    'ga:interestAffinityCategory',
                    'ga:interestInMarketCategory',
                    'ga:dfpLineItemId',
                    'ga:dfpLineItemName',
                    'ga:acquisitionCampaign',
                    'ga:acquisitionMedium',
                    'ga:acquisitionSource',
                    'ga:acquisitionSourceMedium',
                    'ga:acquisitionTrafficChannel',
                    'ga:browserSize',
                    'ga:campaignCode',
                    'ga:channelGrouping',
                    'ga:checkoutOptions',
                    'ga:cityId',
                    'ga:cohort',
                    'ga:cohortNthDay',
                    'ga:cohortNthMonth',
                    'ga:cohortNthWeek',
                    'ga:continentId',
                    'ga:countryIsoCode',
                    'ga:dataSource',
                    'ga:dbmClickAdvertiser',
                    'ga:dbmClickAdvertiserId',
                    'ga:dbmClickCreativeId',
                    'ga:dbmClickExchange',
                    'ga:dbmClickExchangeId',
                    'ga:dbmClickInsertionOrder',
                    'ga:dbmClickInsertionOrderId',
                    'ga:dbmClickLineItem',
                    'ga:dbmClickLineItemId',
                    'ga:dbmClickSite',
                    'ga:dbmClickSiteId',
                    'ga:dbmLastEventAdvertiser',
                    'ga:dbmLastEventAdvertiserId',
                    'ga:dbmLastEventCreativeId',
                    'ga:dbmLastEventExchange',
                    'ga:dbmLastEventExchangeId',
                    'ga:dbmLastEventInsertionOrder',
                    'ga:dbmLastEventInsertionOrderId',
                    'ga:dbmLastEventLineItem',
                    'ga:dbmLastEventLineItemId',
                    'ga:dbmLastEventSite',
                    'ga:dbmLastEventSiteId',
                    'ga:dsAdGroup',
                    'ga:dsAdGroupId',
                    'ga:dsAdvertiser',
                    'ga:dsAdvertiserId',
                    'ga:dsAgency',
                    'ga:dsAgencyId',
                    'ga:dsCampaign',
                    'ga:dsCampaignId',
                    'ga:dsEngineAccount',
                    'ga:dsEngineAccountId',
                    'ga:dsKeyword',
                    'ga:dsKeywordId',
                    'ga:experimentCombination',
                    'ga:experimentName',
                    'ga:internalPromotionCreative',
                    'ga:internalPromotionId',
                    'ga:internalPromotionName',
                    'ga:internalPromotionPosition',
                    'ga:isTrueViewVideoAd',
                    'ga:metroId',
                    'ga:nthHour',
                    'ga:orderCouponCode',
                    'ga:productBrand',
                    'ga:productCategoryHierarchy',
                    'ga:productCategoryLevelXX',
                    'ga:productCouponCode',
                    'ga:productListName',
                    'ga:productListPosition',
                    'ga:productVariant',
                    'ga:regionId',
                    'ga:regionIsoCode',
                    'ga:shoppingStage',
                    'ga:subContinentCode'
                ],
                7
            )
        },
        {
            displayName: 'Metrics',
            id: 'metrics',
            type: selectionType(
                [
                    'ga:users',
                    'ga:visitors',
                    'ga:newUsers',
                    'ga:newVisits',
                    'ga:percentNewSessions',
                    'ga:percentNewVisits',
                    'ga:1dayUsers',
                    'ga:7dayUsers',
                    'ga:14dayUsers',
                    'ga:28dayUsers',
                    'ga:30dayUsers',
                    'ga:sessions',
                    'ga:visits',
                    'ga:bounces',
                    'ga:bounceRate',
                    'ga:visitBounceRate',
                    'ga:sessionDuration',
                    'ga:avgSessionDuration',
                    'ga:organicSearches',
                    'ga:impressions',
                    'ga:adClicks',
                    'ga:adCost',
                    'ga:CPM',
                    'ga:CPC',
                    'ga:CTR',
                    'ga:costPerTransaction',
                    'ga:costPerGoalConversion',
                    'ga:costPerConversion',
                    'ga:RPC',
                    'ga:ROI',
                    'ga:margin',
                    'ga:ROAS',
                    'ga:goalXXStarts',
                    'ga:goalStartsAll',
                    'ga:goalXXCompletions',
                    'ga:goalCompletionsAll',
                    'ga:goalXXValue',
                    'ga:goalValueAll',
                    'ga:goalValuePerSession',
                    'ga:goalValuePerVisit',
                    'ga:goalXXConversionRate',
                    'ga:goalConversionRateAll',
                    'ga:goalXXAbandons',
                    'ga:goalAbandonsAll',
                    'ga:goalXXAbandonRate',
                    'ga:goalAbandonRateAll',
                    'ga:pageValue',
                    'ga:entrances',
                    'ga:entranceRate',
                    'ga:pageviews',
                    'ga:pageviewsPerSession',
                    'ga:pageviewsPerVisit',
                    'ga:contentGroupUniqueViewsXX',
                    'ga:uniquePageviews',
                    'ga:timeOnPage',
                    'ga:avgTimeOnPage',
                    'ga:exits',
                    'ga:exitRate',
                    'ga:searchResultViews',
                    'ga:searchUniques',
                    'ga:avgSearchResultViews',
                    'ga:searchSessions',
                    'ga:searchVisits',
                    'ga:percentSessionsWithSearch',
                    'ga:percentVisitsWithSearch',
                    'ga:searchDepth',
                    'ga:avgSearchDepth',
                    'ga:searchRefinements',
                    'ga:percentSearchRefinements',
                    'ga:searchDuration',
                    'ga:avgSearchDuration',
                    'ga:searchExits',
                    'ga:searchExitRate',
                    'ga:searchGoalXXConversionRate',
                    'ga:searchGoalConversionRateAll',
                    'ga:goalValueAllPerSearch',
                    'ga:pageLoadTime',
                    'ga:pageLoadSample',
                    'ga:avgPageLoadTime',
                    'ga:domainLookupTime',
                    'ga:avgDomainLookupTime',
                    'ga:pageDownloadTime',
                    'ga:avgPageDownloadTime',
                    'ga:redirectionTime',
                    'ga:avgRedirectionTime',
                    'ga:serverConnectionTime',
                    'ga:avgServerConnectionTime',
                    'ga:serverResponseTime',
                    'ga:avgServerResponseTime',
                    'ga:speedMetricsSample',
                    'ga:domInteractiveTime',
                    'ga:avgDomInteractiveTime',
                    'ga:domContentLoadedTime',
                    'ga:avgDomContentLoadedTime',
                    'ga:domLatencyMetricsSample',
                    'ga:screenviews',
                    'ga:uniqueScreenviews',
                    'ga:uniqueAppviews',
                    'ga:screenviewsPerSession',
                    'ga:timeOnScreen',
                    'ga:avgScreenviewDuration',
                    'ga:totalEvents',
                    'ga:uniqueDimensionCombinations',
                    'ga:uniqueEvents',
                    'ga:eventValue',
                    'ga:avgEventValue',
                    'ga:sessionsWithEvent',
                    'ga:visitsWithEvent',
                    'ga:eventsPerSessionWithEvent',
                    'ga:eventsPerVisitWithEvent',
                    'ga:transactions',
                    'ga:transactionsPerSession',
                    'ga:transactionsPerVisit',
                    'ga:transactionRevenue',
                    'ga:revenuePerTransaction',
                    'ga:transactionRevenuePerSession',
                    'ga:transactionRevenuePerVisit',
                    'ga:transactionShipping',
                    'ga:transactionTax',
                    'ga:totalValue',
                    'ga:itemQuantity',
                    'ga:uniquePurchases',
                    'ga:revenuePerItem',
                    'ga:itemRevenue',
                    'ga:itemsPerPurchase',
                    'ga:localTransactionRevenue',
                    'ga:localTransactionShipping',
                    'ga:localTransactionTax',
                    'ga:localItemRevenue',
                    'ga:socialInteractions',
                    'ga:uniqueSocialInteractions',
                    'ga:socialInteractionsPerSession',
                    'ga:socialInteractionsPerVisit',
                    'ga:userTimingValue',
                    'ga:userTimingSample',
                    'ga:avgUserTimingValue',
                    'ga:exceptions',
                    'ga:exceptionsPerScreenview',
                    'ga:fatalExceptions',
                    'ga:fatalExceptionsPerScreenview',
                    'ga:metricXX',
                    'ga:dcmFloodlightQuantity',
                    'ga:dcmFloodlightRevenue',
                    'ga:adsenseRevenue',
                    'ga:adsenseAdUnitsViewed',
                    'ga:adsenseAdsViewed',
                    'ga:adsenseAdsClicks',
                    'ga:adsensePageImpressions',
                    'ga:adsenseCTR',
                    'ga:adsenseECPM',
                    'ga:adsenseExits',
                    'ga:adsenseViewableImpressionPercent',
                    'ga:adsenseCoverage',
                    'ga:totalPublisherImpressions',
                    'ga:totalPublisherCoverage',
                    'ga:totalPublisherMonetizedPageviews',
                    'ga:totalPublisherImpressionsPerSession',
                    'ga:totalPublisherViewableImpressionsPercent',
                    'ga:totalPublisherClicks',
                    'ga:totalPublisherCTR',
                    'ga:totalPublisherRevenue',
                    'ga:totalPublisherRevenuePer1000Sessions',
                    'ga:totalPublisherECPM',
                    'ga:adxImpressions',
                    'ga:adxCoverage',
                    'ga:adxMonetizedPageviews',
                    'ga:adxImpressionsPerSession',
                    'ga:adxViewableImpressionsPercent',
                    'ga:adxClicks',
                    'ga:adxCTR',
                    'ga:adxRevenue',
                    'ga:adxRevenuePer1000Sessions',
                    'ga:adxECPM',
                    'ga:dfpImpressions',
                    'ga:dfpCoverage',
                    'ga:dfpMonetizedPageviews',
                    'ga:dfpImpressionsPerSession',
                    'ga:dfpViewableImpressionsPercent',
                    'ga:dfpClicks',
                    'ga:dfpCTR',
                    'ga:dfpRevenue',
                    'ga:dfpRevenuePer1000Sessions',
                    'ga:dfpECPM',
                    'ga:backfillImpressions',
                    'ga:backfillCoverage',
                    'ga:backfillMonetizedPageviews',
                    'ga:backfillImpressionsPerSession',
                    'ga:backfillViewableImpressionsPercent',
                    'ga:backfillClicks',
                    'ga:backfillCTR',
                    'ga:backfillRevenue',
                    'ga:backfillRevenuePer1000Sessions',
                    'ga:backfillECPM',
                    'ga:buyToDetailRate',
                    'ga:cartToDetailRate',
                    'ga:cohortActiveUsers',
                    'ga:cohortAppviewsPerUser',
                    'ga:cohortAppviewsPerUserWithLifetimeCriteria',
                    'ga:cohortGoalCompletionsPerUser',
                    'ga:cohortGoalCompletionsPerUserWithLifetimeCriteria',
                    'ga:cohortPageviewsPerUser',
                    'ga:cohortPageviewsPerUserWithLifetimeCriteria',
                    'ga:cohortRetentionRate',
                    'ga:cohortRevenuePerUser',
                    'ga:cohortRevenuePerUserWithLifetimeCriteria',
                    'ga:cohortSessionDurationPerUser',
                    'ga:cohortSessionDurationPerUserWithLifetimeCriteria',
                    'ga:cohortSessionsPerUser',
                    'ga:cohortSessionsPerUserWithLifetimeCriteria',
                    'ga:cohortTotalUsers',
                    'ga:cohortTotalUsersWithLifetimeCriteria',
                    'ga:dbmCPA',
                    'ga:dbmCPC',
                    'ga:dbmCPM',
                    'ga:dbmCTR',
                    'ga:dbmClicks',
                    'ga:dbmConversions',
                    'ga:dbmCost',
                    'ga:dbmImpressions',
                    'ga:dbmROAS',
                    'ga:dcmCPC',
                    'ga:dcmCTR',
                    'ga:dcmClicks',
                    'ga:dcmCost',
                    'ga:dcmImpressions',
                    'ga:dcmMargin',
                    'ga:dcmROAS',
                    'ga:dcmRPC',
                    'ga:dsCPC',
                    'ga:dsCTR',
                    'ga:dsClicks',
                    'ga:dsCost',
                    'ga:dsImpressions',
                    'ga:dsProfit',
                    'ga:dsReturnOnAdSpend',
                    'ga:dsRevenuePerClick',
                    'ga:hits',
                    'ga:internalPromotionCTR',
                    'ga:internalPromotionClicks',
                    'ga:internalPromotionViews',
                    'ga:localProductRefundAmount',
                    'ga:localRefundAmount',
                    'ga:productAddsToCart',
                    'ga:productCheckouts',
                    'ga:productDetailViews',
                    'ga:productListCTR',
                    'ga:productListClicks',
                    'ga:productListViews',
                    'ga:productRefundAmount',
                    'ga:productRefunds',
                    'ga:productRemovesFromCart',
                    'ga:productRevenuePerPurchase',
                    'ga:quantityAddedToCart',
                    'ga:quantityCheckedOut',
                    'ga:quantityRefunded',
                    'ga:quantityRemovedFromCart',
                    'ga:refundAmount',
                    'ga:revenuePerUser',
                    'ga:sessionsPerUser',
                    'ga:totalRefunds',
                    'ga:transactionsPerUser'
                ],
                10
            )
        }
    ],
    displayName: 'Google Analytics',
    id: 'google_analytics',
    collectionTypes: ['report'],
    configParameters: [
        {
            displayName: 'View ID',
            id: 'view_id',
            type: stringType,
            required: true
        },
        {
            displayName: 'Auth (Client ID)',
            id: 'auth.client_id',
            type: stringType
        },
        {
            displayName: 'Auth (Client Secret)',
            id: 'auth.client_secret',
            type: stringType
        },
        {
            displayName: 'Auth (Refresh Token)',
            id: 'auth.refresh_token',
            type: stringType
        },
        {
            displayName: 'Auth (Service account key JSON)',
            id: 'auth.service_account_key',
            type: jsonType
        }
    ]
};

const allSourcesList = [facebook, googleAnalytics];

export default allSourcesList;

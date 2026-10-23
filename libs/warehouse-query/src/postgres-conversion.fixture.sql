WITH times AS (
  SELECT
    to_char(
      (now() - interval '1 hour') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ) AS conversion_time,
    to_char(
      (now() - interval '2 hours') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ) AS session_time
)
SELECT
  'google-conversion-test-001'::text AS id,
  conversion_time AS "conversionTimestamp",
  'test-order-001'::text AS "orderId",
  149.95::numeric AS value,
  'USD'::text AS currency,
  'WEB'::text AS "conversionEnvironment",
  'alex@example.com'::text AS email,
  '+12025550123'::text AS phone,
  'US'::text AS "phoneCountryCode",
  'Alex'::text AS "firstName",
  'Example'::text AS "lastName",
  'US'::text AS "countryCode",
  '10001'::text AS "postalCode",
  NULL::text AS "hashedEmail",
  NULL::text AS "hashedPhone",
  NULL::text AS "hashedFirstName",
  NULL::text AS "hashedLastName",
  NULL::text AS gclid,
  NULL::text AS gbraid,
  NULL::text AS wbraid,
  '192.0.2.10'::text AS "userIpAddress",
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'::text AS "userAgent",
  'GRANTED'::text AS "adUserData",
  'GRANTED'::text AS "adPersonalization",
  jsonb_build_object(
    'customer_tier', 'gold',
    'purchase_channel', 'website',
    'loyalty_member', true
  ) AS "customVariables",
  jsonb_build_object(
    'gadSource', '1',
    'gadCampaignId', '123456789',
    'landingPageUrl', 'https://example.com/products/test-product',
    'sessionStartTime', session_time,
    'landingPageReferrer', 'https://www.google.com/',
    'landingPageUserAgent',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
  ) AS "sessionAttributes",
  -- The encoded alternative must remain unmapped when testing the structured object.
  NULL::text AS "sessionAttributesEncoded",
  '123456789'::text AS "merchantId",
  10.00::numeric AS "transactionDiscount",
  jsonb_build_array(
    jsonb_build_object('productId', 'TEST-SKU-001', 'quantity', 2, 'price', 79.975)
  ) AS items,
  NULL::text AS "merchantCountryCode",
  NULL::text AS "merchantLanguageCode"
FROM times;

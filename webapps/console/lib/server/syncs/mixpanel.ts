import { AnyProps, SyncFunction } from "@jitsu/protocols/functions";
import { GoogleAdsApi } from "google-ads-api";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export type GoogleAdsCredentials = {
  credentials: {
    client_id: string;
    access_token: string;
    client_secret: string;
    refresh_token: string;
    developer_token: string;
  };
  customer_id: string;
};

export type FacebookCredentials = {
  client_id: string;
  access_token: string;
  client_secret: string;
};

export type MixpanelAdReportRaw = {
  time: Date;
  source: string;
  campaign_id: string;
  utm_source: string;
  utm_campaign: string;
  cost: number;
  impressions: number;
  clicks: number;
};

export const mixpanelGoogleAdsSync: SyncFunction<AnyProps, GoogleAdsCredentials, {}> = async (props) => {
  const {
    source,
    destination,
    ctx: { log, store },
  } = props;
  log.info(`Starting Mixpanel Google Ads sync: ${JSON.stringify(source, null, 2)}`);
  const googleAdsProps = source.credentials;
  const firstRun = !(await store.get("last-run"));
  const initialLookbackWindowDays = 30,
    lookbackWindowDays = 2;
  const lookbackWindow = firstRun ? initialLookbackWindowDays : lookbackWindowDays;
  await log.info(
    `Connecting to Google Ads API with client id = ${googleAdsProps.credentials.client_id}. Fist run: ${firstRun}, look-back window: ${lookbackWindow} days.`
  );
  const client = new GoogleAdsApi({
    client_id: googleAdsProps.client_id,
    client_secret: googleAdsProps.client_secret,
    developer_token: googleAdsProps.developer_token,
  });

  const customer = client.Customer({
    customer_id: googleAdsProps.customer_id,
    refresh_token: googleAdsProps.credentials.refresh_token,
  });

  const start = `${dayjs().utc().subtract(lookbackWindow, "day").format("YYYYMMDD")}`;
  const end = dayjs().utc().format("YYYYMMDD");
  await customer.query(`
        SELECT
            segments.date,
            campaign.id,
            campaign.name,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions
        FROM
            campaign
        WHERE
            metrics.cost_micros > 0
        AND
            segments.date BETWEEN ${start} AND ${end} 
    `);
};

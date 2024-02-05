import { SyncFunction } from "@jitsu/protocols/functions";
import { MixpanelCredentials } from "../../meta";
import { GoogleAdsSyncProps } from "../mixpanel-destination";
import { GoogleAdsApi } from "google-ads-api";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc)

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

export const googleAdsSync: SyncFunction<MixpanelCredentials, GoogleAdsCredentials, GoogleAdsSyncProps> = async ({
  source,
  destination,
  ctx: { log, store },
}) => {
  const googleAdsProps = source.credentials;
  const firstRun = !(await store.get("last-run"));
  const { initialLookbackWindowDays = 30, lookbackWindowDays = 2 } = source.syncProps;
  const lookbackWindow = firstRun ? initialLookbackWindowDays : lookbackWindowDays;
  await log.info(
    `Connecting to Google Ads API with client id = ${googleAdsProps.credentials.client_id}. Fist run: ${firstRun}, look-back window: ${lookbackWindow} days.`
  );
  const client = new GoogleAdsApi({
    client_id: googleAdsProps.credentials.client_id,
    client_secret: googleAdsProps.credentials.client_secret,
    developer_token: googleAdsProps.credentials.developer_token,
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

import { AnyProps, Store, SyncFunction } from "@jitsu/protocols/functions";
import { GoogleAdsApi } from "google-ads-api";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { requireDefined, rpc } from "juava";

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
  page_size?: number;
  account_ids: string[];
  access_token: string;
  client_secret: string;
  insights_lookback_window?: number;
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

const maxRunTimeSeconds = 60;

function base64(str: string) {
  return btoa(str);
}

function getAuth(props: any) {
  return base64(`${props.serviceAccountUserName}:${props.serviceAccountPassword}`);
}

async function sendMixpanelMessage(props: any, payload: any) {
  const auth = getAuth(props);
  await rpc(`https://api.mixpanel.com/import?project_id=${props.projectId}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  //console.log(`Successfully sent to mixpanel ${JSON.stringify(message)}`);
}

function sortByKey(result: Record<string, any>): Record<string, any> {
  return Object.keys(result)
    .sort()
    .reduce((acc, key) => {
      acc[key] = result[key];
      return acc;
    }, {} as Record<string, any>);
}

async function getDaysToSync(opts: {
  lookbackWindow: number;
  initialSyncDays: number;
  store: Store;
}): Promise<Record<string, any>> {
  const now = dayjs().utc();
  const result: Record<string, any> = {};
  //Those days we always need to sync
  const alwaysSync = Array.from({ length: opts.lookbackWindow }, (_, i) => now.add(-i, "day").format("YYYY-MM-DD"));
  alwaysSync.forEach(day => (result[day] = null));
  const syncIfNotSynced = Array.from({ length: opts.initialSyncDays - opts.lookbackWindow }, (_, i) =>
    now.add(-i - opts.lookbackWindow, "day").format("YYYY-MM-DD")
  );
  for (const day of syncIfNotSynced) {
    const syncStatus = await opts.store.get(`day-synced.${day}`);
    result[day] = syncStatus || null;
  }
  return sortByKey(result);
}

function describeDaysToSync(daysToSync: Record<string, any>) {
  return Object.entries(daysToSync)
    .map(
      ([day, syncStatus]) =>
        `\t${day} → ${syncStatus === null ? "🚀WILL SYNC" : `✂️WONT SYNC (${JSON.stringify(syncStatus)})`}`
    )
    .join("\n");
}

export const mixpanelFacebookAdsSync: SyncFunction<AnyProps, FacebookCredentials, {}> = async props => {
  const started = Date.now();
  const {
    source,
    destination,
    ctx: { log, store },
  } = props;
  if (source.credentials.account_ids.length === 0) {
    throw new Error("No account ids provided");
  } else if (source.credentials.account_ids.length > 1) {
    await log.warn(
      `Multiple account ids provided - ${JSON.stringify(source.credentials.account_ids)}. Using the first one: ${
        source.credentials.account_ids[0]
      }`
    );
  }
  const daysToSync = await getDaysToSync({ lookbackWindow: 2, initialSyncDays: 30, store });
  await log.info(
    `Following days will be synced (${Object.keys(daysToSync).length})\n${describeDaysToSync(daysToSync)}`
  );
  const reportFields = [
    "campaign_id",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "ad_name",
    "ad_id",
    "adset_name",
    "adset_id",
  ];
  const baseUrl = `https://graph.facebook.com/v17.0/act_${source.credentials.account_ids[0]}/insights`;
  let nextPageUrl: string | undefined = undefined;
  for (const day of Object.entries(daysToSync)
    .filter(([day, val]) => val === null)
    .map(([day, val]) => day)) {
    if (Date.now() - started > maxRunTimeSeconds * 1000) {
      await log.info(
        `Syncing took more than ${maxRunTimeSeconds} seconds. Stopping. Rest of the days will be synced next time.`
      );
      break;
    }
    await log.info(`Fetching Facebook Ads data for the day: ${day}`);
    let totalDailyReportRows = 0;
    while (true) {
      const headers = {
        "Content-Type": "application/json",
      };

      const data = nextPageUrl
        ? await rpc(nextPageUrl, { headers })
        : await rpc(baseUrl, {
            query: {
              access_token: source.credentials.access_token,
              level: "ad",
              fields: reportFields.join(","),
              time_range: JSON.stringify({ since: day, until: day }),
              limit: 1000,
              filtering: JSON.stringify([
                {
                  field: "spend",
                  operator: "GREATER_THAN",
                  value: 0,
                },
              ]),
            },
            headers,
          });
      const { paging } = data;
      nextPageUrl = paging?.next;
      const reports = data.data as any[];
      totalDailyReportRows += reports.length;
      await log.debug(
        `Fetched ${
          reports.length
        } rows. Total rows for ${day}: ${totalDailyReportRows}. Has next page: ${!!nextPageUrl}. Sending data to mixpanel`
      );
      const mixpanelMessages: any[] = [];
      for (const row of reports) {
        const campaignDay = dayjs(day).utc().startOf("day").toDate();
        const campaignId = requireDefined(row.campaign_id);
        const insertId = `G-${campaignDay.toISOString()}-${campaignId}`;
        const mixPanelMessage = {
          event: "Ad Data",
          properties: {
            $insert_id: insertId,
            //            distinct_id: insertId,
            // We need to turn the date into a Unix timestamp
            time: campaignDay.getTime(),
            source: "facebook",
            campaign_id: campaignId,

            // metadata about the campaign; matches client side events
            utm_source: "facebook",
            utm_campaign: requireDefined(row.campaign_name),
            utm_content: requireDefined(row.adset_name),
            utm_term: requireDefined(row.ad_name),

            // Google's cost metric is 1 millionth of the fundamental currency specified by your Ads Account.
            cost: parseFloat(requireDefined(row.spend)),
            impressions: parseInt(requireDefined(row.impressions)),
            clicks: parseInt(requireDefined(row.clicks)),
          },
        };
        mixpanelMessages.push(mixPanelMessage);
      }
      await log.info(`Sending ${mixpanelMessages.length} rows to mixpanel`);
      await sendMixpanelMessage(destination, mixpanelMessages);
      if (!nextPageUrl) {
        break;
      }
    }
    await store.set(`day-synced.${day}`, { totalDailyReportRows, time: new Date().toISOString() });
  }
};

export const mixpanelGoogleAdsSync: SyncFunction<AnyProps, GoogleAdsCredentials, {}> = async props => {
  const {
    source,
    destination,
    ctx: { log, store },
  } = props;
  const googleAdsProps = source.credentials;
  const daysToSync = await getDaysToSync({ lookbackWindow: 2, initialSyncDays: 30, store });
  await log.info(
    `Following days will be synced (${Object.keys(daysToSync).length})\n${describeDaysToSync(daysToSync)}`
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

  for (const day of Object.entries(daysToSync)
    .filter(([day, val]) => val === null)
    .map(([day]) => day)) {
    await log.info(`Fetching Google Ads data for the day: ${day}`);

    const campaigns = await customer.query(`
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
            segments.date BETWEEN '${day}' AND '${day}' 
    `);

    const mixpanelEvents = campaigns.map((campaign: any) => ({
      event: "Ad Data",
      properties: {
        $insert_id: `G-${campaign.segments.date}-${campaign.campaign.id}`,
        time: new Date(campaign.segments.date).getTime(),
        source: "Google",
        campaign_id: campaign.campaign.id,

        utm_source: "google",
        utm_campaign: campaign.campaign.name,
        cost: campaign.metrics.cost_micros / 1_000_000,
        impressions: campaign.metrics.impressions,
        clicks: campaign.metrics.clicks,
      },
    }));
    await sendMixpanelMessage(destination, mixpanelEvents);
    await store.set(`day-synced.${day}`, { time: new Date().toISOString(), rows: campaigns.length });
  }
};

import {Hint} from "../../../components/documentationComponents";

# Facebook Marketing

Facebook Marketing driver supports `insights` collection type and allows you to retrieve advertisements statistics based on [Insights API](https://developers.facebook.com/docs/marketing-api/insights/?locale=en_EN). The data is loaded by daily chunks.

Configuration example:

```yaml
sources:
  facebook:
    type: facebook_marketing
    destinations:
      - "<DESTINATION_ID>"
    collections:
      - name: "insights"
        type: "insights"
        parameters:
          fields: [ "account_currency", "account_id", "account_name", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "objective", "buying_type","cpc", "cpm", "cpp", "ctr", "estimated_ad_recall_rate", "estimated_ad_recallers", "reach", "unique_clicks", "unique_ctr", "frequency", "actions", "conversions", "spend", "impressions" ]
          level: "ad"
      - name: 'ads'
        type: 'ads'
        parameters:
          fields: ["bid_amount", "adlabels", "creative", "status", "created_time", "updated_time", "targeting", "effective_status", "campaign_id", "adset_id", "conversion_specs", "recommendations", "id", "bid_info", "last_updated_by_app_id", "tracking_specs", "bid_type", "name", "account_id", "source_ad_id"]
    config:
      account_id: '<FACEBOOK_AD_ACCOUNT_ID>'
      access_token: '<FACEBOOK_ACCESS_TOKEN>'
```

Collection parameters:

| Parameter  | Description |
| :-------   | :---------  |
| `fields` (required)   | Report fields. A list of fields is available in [Facebook documentation](https://developers.facebook.com/docs/marketing-api/insights/parameters/v9.0#fields) |
| `level`    | Response level. One of `ad`, `adset`, `campaign`, `account` . For more details, see [Facebook documentation](https://developers.facebook.com/docs/marketing-api/reference/adgroup/insights/). Default value is : `ad` |

Configuration parameters:

| Parameter | Description |
| :--- | :--- |
| `account_id`  (required) | Ad account identifier. Instruction on [how to find account id](https://www.facebook.com/business/help/1492627900875762) |
| `access_token` (required) | OAuth token to access your ad account. Instruction on [how to get access token](/docs/sources-configuration/facebook-marketing#how-to-get-access-token) |


## How to get Facebook access token

Open [Facebook page](https://developers.facebook.com/tools/explorer)

![Developers explorer](/img/docs/developers-facebook.png)

- Select Facebook app which has access to your Facebook advertisements data
- Select User token
- Select two permissions: `read_insights` and `ads_read`
- Click Generate Access Token

<Hint>
    Generated access token is valid only 1 hour. For generating long lived access token read <a href="https://developers.facebook.com/docs/pages/access-tokens/#get-a-long-lived-user-access-token">Facebook documentation</a>
</Hint>

![Generate access token](/img/docs/token-generator.png)

Once token is issued, check it by sending CURL

```bash
curl 'https://graph.facebook.com/v9.0/act_<FACEBOOK_AD_ACCOUNT_ID>/insights?access_token=<FACEBOOK_ACCESS_TOKEN>'
```
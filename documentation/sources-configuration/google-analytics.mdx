import {Hint} from "../../../components/documentationComponents";

# Google Analytics

Google Analytics driver supports `report` collection and allows load data using [Reporting API](https://developers.google.com/analytics/devguides/reporting/core/v4?authuser=1). It loads data by day chunks (get report per each day).

Reports consist of metrics and dimensions. The list of metrics and dimensions may be found on the [Google Analytics Demos&Tools](https://ga-dev-tools.appspot.com/dimensions-metrics-explorer/) page.

<Hint>
    There is a limitation of 10 metrics and 7 dimensions per report. If you need more, you will have to configure multiple sources.
</Hint>

### Report collection

The report is a [parametrized collection](./#collections). To configure it, one should provide a list of metrics and dimensions for reporting. For example, the following collection configuration would load the report of sessions number per country:

```yaml
collections:
  - name: "report_test"
    type: "report"
    parameters:
      dimensions: [ "ga:country" ]
      metrics: [ "ga:sessions" ]
```

As the data is loaded by month chunks, you will have to use an aggregation query to see the full statistics of sessions by country. In SQL storage, the query will be like:

```sql
select country, sum(sessions) as s_sessions
from report_test
group by country;
```

### Source configuration

Google Analytics driver configuration example:

```yaml
sources:
  ...
  ga_example_id:
    type: google_analytics
    destinations:
      - "test_destination_2"
    collections:
      - name: "report_test"
        type: "report"
        parameters:
          dimensions: [ "ga:country", "ga:yearMonth" ]
          metrics: [ "ga:sessions" ]
    config:
      view_id: "<VIEW_ID_VALUE>"
      auth:
        service_account_key: "<GOOGLE_SERVICE_ACCOUNT_KEY_JSON>"
  ...
```


### Parameters description

| Parameter | Description |
| :--- | :--- |
| `view_id` (required) | Google Analytics account View ID to synchronize (how to find View ID see [below](/docs/sources-configuration/google-analytics#how-to-find-google-analytics-view-id)  |
| `auth` (required) | [Google authorization](/docs/configuration/google-authorization) configuration |


### How to find Google Analytics View ID

To find `view_id` value, go to the home [Google Analytics page](https://analytics.google.com/) of the ad account you want to sync, open `Admin` section, at column `View` click `View Settings`.

![Google Analytics Menu](/img/docs/google-analytics-view-id.png)

There you would find View ID:

![Google Analytics View ID](/img/docs/google-analytics-view-id-scroll.png)

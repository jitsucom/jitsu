---
sort: 1
---


import {CodeInTabs, CodeTab} from "../../../components/Code";
import {Hint} from "../../../components/documentationComponents";

# Deploy to Heroku

![Heroku Dialog](/img/docs/deployment-heroku.png)

[Heroku](https://www.heroku.com/) is the easiest way to get started with **EventNative**. If you don't have an active Heroku account you can [signup here](https://signup.heroku.com/)!

### Getting Running on Heroku

* Pick a destination for your event data, we recommend starting with [Postgres](https://devcenter.heroku.com/articles/heroku-postgresql).
* Click our [Deploy](https://heroku.com/deploy?template=https://github.com/jitsucom/eventnative) to Heroku link.
* Add your **EventNative** [configuration](/docs/configuration/) in raw JSON format.

![JSON Configuration](/img/docs/heroku-en-configuration.png)

<Hint>
    Make sure to update <code inline="true">server.auth</code> parameter with <a target="_blank" href="https://www.uuidgenerator.net">generated UUID</a> and all values in &lt;&gt; with your credentials.
</Hint>

<CodeInTabs>
    <CodeTab lang="json" title="Redshift">
        {`
{
  "server": {
    "public_url": "<APP NAME>.herokuapp.com",
    "auth": "<Generated UUID>"
  },
  "destinations": {
    "redshift": {
      "mode": "stream",
      "datasource": {
        "host": "<your_host>",
        "db": "<your_db>",
        "username": "<your_username>",
        "password": "<your_password>"
      }
    }
  }
}
        `}
    </CodeTab>
    <CodeTab lang="json" title="Postgres">
        {`
{
  "server": {
    "public_url": "<APP NAME>.herokuapp.com",
    "auth": "<Generated UUID>"
  },
  "destinations": {
    "postgres": {
      "mode": "stream",
      "datasource": {
        "host": "<your_host>",
        "db": "<your_db>",
        "username": "<your_username>",
        "password": "<your_password>"
      }
    }
  }
}
        `}
    </CodeTab>
    <CodeTab lang="json" title="BigQuery">
        {`
{
  "server": {
    "public_url": "<APP NAME>.herokuapp.com",
    "auth": "<Generated UUID>"
  },
  "destinations": {
    "bigquery": {
      "mode": "batch",
      "google": {
        "gcs_bucket": "<your_bucket>",
        "bq_project": "<your_project>",
        "key_file": "{place a content of your JSON key here}"
      }
    }
  }
}
        `}
    </CodeTab>
    <CodeTab lang="json" title="ClickHouse">
        {`
{
  "server": {
    "public_url": "<APP NAME>.herokuapp.com",
    "auth": "<Generated UUID>"
  },
  "destinations": {
    "clickhouse": {
      "mode": "stream",
      "clickhouse": {
        "dsns": [
          "http://username:password@host:port/db?read_timeout=5m&timeout=5m&enable_http_compression=1&other_clickhouse_parameters"
        ],
        "db": "<your_db>"
      }
    }
  }
}
        `}
    </CodeTab>
</CodeInTabs>

<Hint>
    If you're using <b>BigQuery</b>,  please copy JSON content of BigQuery key file and place it under <code inline="true">key_file</code> node!
</Hint>

* Click **Deploy App** and you're alive!
* After your app is deployed, you can visit the following link to confirm deployment  [https://your_app.herokuapp.com](https://your-app.herokuapp.com/t/welcome.html)

Once your backend is set up,  place the following code on your web-app. (See our [JavaScript guide](/docs/sending-data/javascript-reference/#quickstart) for fine-tuning):

```html
<script src="https://[your_app].herokuapp.com/t/inline.js?key=<SERVER_AUTH_FROM_CONFIG>" async>
</script>
```


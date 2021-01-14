<table><tr><td><img width="200"  src="https://github.com/jitsucom/eventnative/blob/master/artwork/logo-256x256.png?raw=true"></td><td>

**EventNative** is an open source, high-performance, event collection service. Capture all events your application generates and stream to your preferred Data Warehouse with current support for ClickHouse, BigQuery, RedShift, Postgres, Snowflake and S3. EventNative can be deployed in 1-click on the infrastructure of your choice.<br>
   <a href="https://circleci.com/gh/jitsucom/eventnative/tree/master"><img align="right" width="100" src="https://circleci.com/gh/jitsucom/eventnative/tree/master.svg?style=svg&circle-token=52a01ca8af325a73c950df2aa1953f68933383c3"></a> <a href=#><img align="right" width="100" src="https://raw.githubusercontent.com/jitsucom/eventnative/master/artwork/go.png"></a></td></tr></table><br><p align="center"><img width="600px" src="https://raw.githubusercontent.com/jitsucom/eventnative/master/artwork/en-video.gif"></p>
   
<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/eventnative/master/artwork/quick-n.png" width="40px"></a>
## Quick Start
The fastest way to get started is one click [deploy on Heroku](https://docs.eventnative.org/deployment/deploy-on-heroku) with:

<a href="https://heroku.com/deploy?template=https://github.com/jitsucom/eventnative"><img src="https://raw.githubusercontent.com/jitsucom/eventnative/7eb28378b252ac7c3209457ca3766be806085e41/artwork/heroku.svg" width="200px" /></a>

For production deployment we suggest Docker:
 * [Official ksense/eventnative](https://hub.docker.com/r/ksense/eventnative) image
 * [Docker deployment guide](https://docs.eventnative.org/deployment/deploy-with-docker)
 * Also, you can [build EventNative from sources](https://docs.eventnative.org/deployment/build-from-sources) and use configuration management of your choice


<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/eventnative/master/artwork/feat-n.png" width="40px" /></a>

Also, we have <a href="https://app.eventnative.com/#/register">a hosted version of EventNative</a> where you can experiment with the product without running your own server.

## Features
 * **Drop-in Segment & Google Analytics Backend**: No need to modify your existing tracking code if you're using `analytics.js` or `Google Analytics`, just add a few lines of [JavaScript](https://docs.eventnative.org/javascript-reference/direct-tracking) and you're set!
 
 * **Self Hosted Tracker**: Don't want to send your user data to third parties? Use our self hosted [tracker](https://docs.eventnative.org/javascript-reference).
 
 * **Capture Events stopped by AdBlock**: Since EventNative is hosted on your domain, you get events for all users; not just those without AdBlock.

 * **Multiple Destination Support**: We support [Redshift](https://docs.eventnative.org/quick-start), [BigQuery](https://docs.eventnative.org/quick-start), [PostgreSQL](https://www.postgresql.org/), [ClickHouse](https://clickhouse.tech/), [Snowflake](https://www.snowflake.com/). EventNative automatically pushes to all your configured destinations at once without additional overhead.
 
 * **High-Performance and Throughput**: EventNative is written in [Go](https://golang.org/) with performance in mind, you're only limited by local disk performance since we write events locally prior to sending them to your data warehouse in batches. Read more about scalability [here](https://docs.eventnative.org/scaling-eventnative).
 
 * **Dynamic Schema and JSON Interface**: EventNative parses incoming requests and adjusts the underlying schema automatically. We map JSON events to tables and create necessary columns on the fly.
 
 * **Data Enrichment**: EventNative can connect with [MaxMind's](https://www.maxmind.com/en/home) selfhosted DB for geo resolution to determine a user's country, city, and zip code from their IP address
   
 * **Retrospective User Recognition**: [Coming soon](https://github.com/jitsucom/eventnative/issues/25) for selected destination (BigQuery, pSQL and ClickHouse).
 
 * **Mobile Application SDKs**: Coming soon for [iOS](https://github.com/jitsucom/eventnative/issues/4) and [Android](https://github.com/jitsucom/eventnative/issues/5).
 
 * **Telemetry**: To help us improve EventNative, we collect usage metrics **without any customer data**. For more details, please check out our [wiki page](https://github.com/jitsucom/eventnative/wiki/Telemetry).


<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/eventnative/master/artwork/demo-n.png" width="40px" /></a>
## Demo

We host a [simple page that demonstrates how EventNative works](https://track-demo.ksense.co/). Once your instance is deployed, visit this page to see how tracking works.

<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/eventnative/master/artwork/doc-n.png" width="40px" /></a>

## Documentation

Please see our extensive documentation [here](https://docs.eventnative.org/). Key sections include:
 * [Deployment](https://docs.eventnative.org/deployment) - Getting EventNative running on Heroku, Docker, and building from source.
 * [Configuration](https://docs.eventnative.org/configuration) - How to modify EventNative's `yaml` file. 
 * [Geo Data](https://docs.eventnative.org/geo-data-resolution) - Configuring data enrichment with [MaxMind](https://www.maxmind.com/en/home).
 * [Scaling](https://docs.eventnative.org/scaling-eventnative) - How to setup a distributed deployment of EventNative. 
 

<a href="#"><img align="right" src="https://raw.githubusercontent.com/jitsucom/eventnative/master/artwork/com-n.png" width="40px" /></a>
##  Community
We are made for developers, by developers and would love to have you join our community.
 * [Wiki](https://github.com/jitsucom/eventnative/wiki) - Check out our development wiki.
 * [Slack](https://jitsu.com/slack) - Join our slack.
 * [Email](mailto:team@eventnative.org) - Send us an email.
 * Submit a pull request!



## Open Source

EventNative is developed and maintained by [Jitsu](https://jitsu.com/) under the MIT license. We charge for hosted services available at [Jitsu](https://jitsu.com/)

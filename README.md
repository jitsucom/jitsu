<table><tr><td><img width="200"  src="https://track-demo.ksense.co/readme/en-round.png"></td><td>

**EventNative** is an open source, high-performance, event collection service. Capture all events your application generates and stream to your preferred Data Warehouse with current support for RedShift and BigQuery. EventNative can be deployed in 1-click on the infrastructure of your choice.<br>
   <a href="https://circleci.com/gh/ksensehq/eventnative/tree/master"><img align="right" width="100" src="https://circleci.com/gh/ksensehq/eventnative/tree/master.svg?style=svg&circle-token=52a01ca8af325a73c950df2aa1953f68933383c3"></a> <a href=#><img align="right" width="100" src="https://track-demo.ksense.co/readme/made-with-go.png"></a></td></tr></table><br>


<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/start.svg" width="40px"></a>
## Quick Start
The fastest way to get started is one click deploy on Heroku with:<br>
<a href="https://heroku.com/deploy?template=https://github.com/ksensehq/eventnative"><img src="https://www.herokucdn.com/deploy/button.svg" width="200px" /></a>


The easiest way to deploy on your own server is using Docker:<br>
<a href="https://docs.eventnative.dev/deployment/deploy-with-docker"><img src="https://track-demo.ksense.co/readme/docker-12.png" width="200px" /></a>


<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/features.svg" width="40px" /></a>

## Features
 * **Drop-in Segment & Google Analytics Backend**: No need to modify your existing tracking code if you're using `analytics.js` or `Google Analytics`, just add a few lines of [JavaScript](https://app.gitbook.com/@eventnative/s/eventnative/javascript-integration) and you're set!
 
 * **Self Hosted Tracker**: Don't want to send your user data to third parties? Use our self hosted [tracker](https://docs.eventnative.dev/javascript-integration/direct-tracking).
 
 * **Capture Events stoped by AdBlock**: Since EventNative is hosted on your domain, you get events for all users; not just those withour AdBlock.

 * **Multiple Destination Support**: We support [Redshift](https://docs.eventnative.dev/quick-start), [BigQuery](https://docs.eventnative.dev/quick-start), Snowflake ([Coming Soon](https://github.com/ksensehq/eventnative/issues/6)), PostgreSQL ([Coming Soon](https://github.com/ksensehq/eventnative/issues/1)).
 
 * **High-Performance and Throughput**: EventNative is written in [Go](https://golang.org/) with performance in mind, you're only limited by local disk performance since we write events locally prior to sending them to your data warehouse in batches. Read more about scalability [here](https://docs.eventnative.dev/scaling-eventnative).
 
 * **Dynamic Schema and JSON Interface**: EventNative parses incoming requests and adjust the underlying schema automatically.
 
 * **No Schema Definitions Needed**: We automatically map JSON events to tables and create necessary columns on the fly.
  
 * **Retrospective User Recognition**: [Coming soon](https://docs.eventnative.dev/quick-start) for BigQuery.
 
 * **Mobile Application SDKs**: Coming soon for [iOS](https://github.com/ksensehq/eventnative/issues/4) and [Android](https://github.com/ksensehq/eventnative/issues/5).


<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/demo-new.svg" width="40px" /></a>
## Demo

We host a [simple page that demonstrates how EventNative works](https://track-demo.ksense.co/). Once your instance is deployed, visit this page to see how tracking works.

<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/docs.svg" width="40px" /></a>

## Documentation

Please see our extensive documentation [here](https://eventnative-docs.ksense.io). Key sections include:
 * [Deployment](https://docs.eventnative.dev/deployment) - Getting EventNative running on Heroku, Docker, and building from source.
 * [Configuration](https://docs.eventnative.dev/configuration) - How to modify EventNative's `yaml` file. 
 * [Geo Data](https://docs.eventnative.dev/geo-data-resolution) - Configuring data enrichment with [MaxMind](https://www.maxmind.com/en/home).
 * [Scaling](https://docs.eventnative.dev/scaling-eventnative) - How to setup a distributed deployment of EventNative. 
 

<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/com.svg" width="40px" /></a>
##  Community
We are made for developers, by developers and would love to have you join our community.
 * [Wiki](https://github.com/ksensehq/eventnative/wiki) - Check out our development wiki.
 * [Slack](https://join.slack.com/t/eventnative/shared_invite/zt-gincgy2s-ZYwXXBjw_GIN1PhVzgaUNA) - Join our slack.
 * [Email](mailto:team@eventnative.org) - Send us an email.
 * Submit a pull request!


<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/logo-color.svg" width="40px" /></a>
## Open Source

EventNative is developed and maintained by [kSense](https://ksense.io/) under the MIT license. We charge for ETL from other datasources and let you connect your EventNative destination to kSense for analysis if you choose.

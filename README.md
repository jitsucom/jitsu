<table><tr> 
  <td>  <img width="200"  src="https://track-demo.ksense.co/readme/en-round.png"></td>
  <td>

**EventNative** is an open source, high-performance event collection service. Capture all events your application generates and stream to your favorite data lake (with current support for RedShift and BigQuery). EventNative can be deployed in 1-click on the infrastructure of your choice.<br>
   <a href="https://circleci.com/gh/ksensehq/eventnative/tree/master"><img align="right" width="100" src="https://circleci.com/gh/ksensehq/eventnative/tree/master.svg?style=svg&circle-token=52a01ca8af325a73c950df2aa1953f68933383c3"></a> <a href=#><img align="right" width="100" src="https://track-demo.ksense.co/readme/made-with-go.png"></a> </td>
   </tr>
</table><br>


<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/start.svg" width="40px"></a>
## Quick Start
The fastest way to get started is one click deploy on Heroku with:<br>
<a href="https://heroku.com/deploy?template=https://github.com/ksensehq/eventnative"><img src="https://www.herokucdn.com/deploy/button.svg" width="200px" /></a>


The easiest way to deploy on your own server is using Docker:<br>
<a href="https://app.gitbook.com/@eventnative/s/eventnative/deployment/deploy-with-docker"><img src="https://track-demo.ksense.co/readme/docker-12.png" width="200px" /></a>


<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/features.svg" width="40px" /></a>

## Features

 * Multiple destination support: Redshift, BigQuery Snowflake [Coming Soon], PostgreSQL [Coming Soon]
 * Drop-in Segment and Google Analytics replacement: No need to change tracking code if you're using analytics.js, just add a few lines of [JS](https://app.gitbook.com/@eventnative/s/eventnative/javascript-integration).
 * High-performance and throughput. EventNative is written in Go and only limited by local disk performance (we log events to  disk and send them to your data warehouse in batches)
 * Flexible-schema and JSON based interface: EventNative adjust the schema for any event data it receives
 * No need to maintain schema: we automatically map JSON events to tables and create necessary columns
 * Any event & data structure is support [Coming Soon]
 * Retrospective user recognition for BigQuery [Coming Soon]

<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/demo-new.svg" width="40px" /></a>
## Demo

We host a [simple page that demonstrates how EventNative works](https://track-demo.ksense.co/). Once your instance is deployed, visit this page to see how tracking works.

<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/docs.svg" width="40px" /></a>

## Documentation

Please see our extensive documentation [here](https://eventnative-docs.ksense.io). Main topics include:
 * [Deployment](https://eventnative-docs.ksense.io/deployment)
 * [Configuration](https://eventnative-docs.ksense.io/configuration)
 * [Geo Data](https://app.gitbook.com/@eventnative/s/eventnative/geo-data-resolution)
 * [Scaling](https://app.gitbook.com/@eventnative/s/eventnative/scaling-eventnative)
 

<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/com.svg" width="40px" /></a>
##  Community
We are made for developers, by developers and would love to have you join our community.
 * [Wiki] (https://github.com/ksensehq/eventnative/wiki) - Check out our development wiki.
 * [Slack] (https://join.slack.com/t/eventnative/shared_invite/zt-gincgy2s-ZYwXXBjw_GIN1PhVzgaUNA) - Join our slack.
 * Send us a pull request!


<a href="#"><img align="right" src="https://track-demo.ksense.co/readme/logo-color.svg" width="40px" /></a>
## About EventNative

EventNative is developed and maintained by [kSense](https://ksense.io/) under the MIT license. We charge for ETL from other datasources and let you connect your EventNative destination to kSense for analysis if you choose.

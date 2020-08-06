# EventNative

EventNative is an open source, high-performance event collection service. Capture all events your application generates and stream to your favorite data lake (we currently support RedShift and BigQuery). EventNative can be deployed in 1-click on the infrastructure of your choice.

## Quick Start
The button below will deploy the master branch of EventNative on Heroku

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/ksensehq/eventnative)

For on-prem deployment we recommend using [Docker](https://eventnative-docs.ksense.io/deployment#deploy-with-docker).

## Demo

We host a [simple page that demonstrates how EventNative works](https://track-demo.ksense.co/). Once your instance is deployed, visit this page to see how tracking works.

## Features

 * Multiple destination support: Redshift, BigQuery (Snowflake, PostgreSQL - *coming soon*)
 * Drop-in Segment and Google Analytics replacement: No need to change tracking code if you're using analytics.js, just add a few lines of [JS](https://app.gitbook.com/@eventnative/s/eventnative/javascript-integration).
 * High-performance and throughput. EventNative is written in Go and only limited by local disk performance (we log events to  disk and send them to your data warehouse in batches)
 * Flexible-schema and JSON based interface: EventNative adjust the schema for any event data it receives
 * No need to maintain schema: we automatically map JSON events to tables and create necessary columns
 * Any event & data structure is support [Coming Soon]
 * Retrospective user recognition for BigQuery [Coming Soon]

## Documentation and Configuration

Please, check out [website](https://eventnative-docs.ksense.io) for thorough documentation. Main topics:
 * [Deployment](https://eventnative-docs.ksense.io/deployment)
 * [Configuration](https://eventnative-docs.ksense.io/configuration)
 * Also, you're welcome to Join our Slack!
 * If you want to contribute to the development, we'd be delight! Please read our [development wiki](https://github.com/ksensehq/eventnative/wiki). Also, we have a #dev channel in our Slack

## About EventNative

EventNative is developed and maintained by [kSense](https://ksense.io/) under the MIT license. We charge for ETL from other datasources and let you connect your EventNative to kSense for analysis if you choose.


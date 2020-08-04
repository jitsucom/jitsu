# EventNative

EventNative is an open source, high-performance event collection service. Capture all events your application generates and stream to your favorite data lake (we support RedShift and BigQuery so far). EventNative can be deployed in 1-click on the infrastructure of your choice.

## Quickstart
The button below will deploy the master branch of EventNative on heroku

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/ksensehq/tracker)

For on-prem deployment [Docker](https://eventnative-docs.ksense.io/deployment#deploy-with-docker) is our standard way.

## Demo

We host a [simple page that demonstrates how EventNative works](http://track-demo.ksense.co.s3-website-us-east-1.amazonaws.com/). Once you instance is deployed, you can use this page to check how tracking works.

## Features

 * Multiple destination support: Redshift, BigQuery (Snowflake, pSQL - *coming soon*)
 * Drop-in Segment and Google Analytics replacement: No need to change tracking code if you're using analytics.js, just add a few lines of js code. More at [client side integratiob]
 * High-performance and throughput. EventNative is written in Go and the real limitation is a local disk performance (we log events to the disk and send them to DWH in batches)
 * Flexible-schema / JSON based interface. Any event data can be sent to EventNative, the schema will be automatically adjusted.
 * No need to maintain DHW schema. We automatically map JSON events to tables and create necessary columns
 * Also, any event / data structure is supported. No
 * (coming soon) Retrospective user recognition for BigQuery.
 
## Documentation and 

Please, check out [website](https://eventnative-docs.ksense.io) for thorough documentation. Main topics:
 * [Deployment](https://eventnative-docs.ksense.io/deployment)
 * [Configuration](https://eventnative-docs.ksense.io/configuration)
 * Also, you're welcome to Join our Slack!
 * If you want to contribute to the development, we'd be delight! Please read our [development wiki](https://github.com/ksensehq/eventnative/wiki). Also, we have a #dev channel in our Slack

## About

EventNative is developed at [kSense](https://ksense.io/)  and licenced under MIT license. We offer EventNative for free and making money from additional products (datasources integrations)


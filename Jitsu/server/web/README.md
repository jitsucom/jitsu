# EventNative JavaScript Library

EventNative is an open source, high-performance event collection service. Read more:
* [Project Github page](https://github.com/jitsucom/jitsu/server/)
* [Javascript integration documentation](https://docs.eventnative.org/sending-data/javascript-reference)


## Install
`npm install --save @jitsu/eventnative` or `yarn add @jitsu/eventnative`

## Usage
**Full version of JavaScript integration can be found [here](https://docs.eventnative.org/sending-data/javascript-reference). A simplified version is presented below**

```javascript 
import eventN from '@jitsu/eventnative';

// initialization
eventN.init({
    "key": "<if key>", //api
    "tracking_host": "<tracking host>",
    "segment_hook": if eventN should listen to Segment's analytics.js events,
    "ga_hook": if eventN should listen to Google Analitics event
});

// push user info
eventN.id({ ...user properties}); 

// push event
eventN.track('pageview');

```
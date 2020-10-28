# EventNative JavaScript Library

EventNative is an open source, high-performance event collection service. Read more:
* [Project Github page](https://github.com/ksensehq/eventnative/)
* [Javascript integration documentation](https://docs.eventnative.org/javascript-integration)


## Install
`npm install --save  @ksense/eventnative`

## Usage
**Full version of JavaScript integration can be found [here](https://docs.eventnative.org/javascript-integration). A simplified version is presented below**

```javascript 
const { eventN } = require('@ksense/eventnative');

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
# EventNative JavaScript Library

EventNative is an open source, high-performance event collection service. Read more:
* [Project Github page](https://github.com/ksensehq/eventnative/)
* [Javascript integration documentation](https://eventnative-docs.ksense.io/javascript-integration)


## Install
`npm install --save  @ksense/eventnative`

## Usage
<p class="callout warning"><b>Full version of JavaScript integration can be found [here](https://eventnative-docs.ksense.io/javascript-integration). A simplified version is presented below</b></p>

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
## Props
```typescript
type IEventN = {
  id: (userProperties: Object, doNotSendEvent: boolean) => void
  track: (event_type: string, event_data: any) => void
  init: (options: {
    key: string,
    cookie_domain?: string
    tracking_host?: string
    cookie_name?: string
    segment_hook?: boolean
    ga_hook?: boolean
  }) => void
}
export const eventN: IEventN
```

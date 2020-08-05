# EventNative

EventNative is an open source, high-performance event collection service. Capture all events your application generates and stream to your favorite data lake (we support RedShift and BigQuery so far). EventNative can be deployed in 1-click on the infrastructure of your choice.

## Demo

We host a [simple page that demonstrates how EventNative works](http://track-demo.ksense.co.s3-website-us-east-1.amazonaws.com/). Once you instance is deployed, you can use this page to check how tracking works.

## Install
`npm install --save  @ksense/eventnative`

## Usage

```javascript 
const { eventN } = require('@ksense/eventnative');

// initialization
eventN.init({
    "key": "0a5b6e03-703c-4703-99f1-dfec3d063670",
    "tracking_host": "http://localhost",
    "segment_hook": true,
    "ga_hook": true
});

// push event
eventN.track('pageview');

// push user info
eventN.id({internal: 'lrk6i3fpw5h3nd4s1d5er', email: 'lrk6i3fpw5h3nd4s1d5er@gmail.com'}); 
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

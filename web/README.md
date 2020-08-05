# EventNative JavaScript Library

EventNative is an open source, high-performance event collection service. Read more:
* [Project Github page](https://github.com/ksensehq/eventnative/)
* [Javascript integration documentation](https://eventnative-docs.ksense.io/javascript-integration)


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

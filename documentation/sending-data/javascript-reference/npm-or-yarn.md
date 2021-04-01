---
sort: 1
---

import {CodeInTabs, CodeTab} from "../../../../components/Code";
import {Hint} from '../../../../components/documentationComponents'

# Installing with Npm or Yarn

EventNative is packaged and available as an npm module.

Use the following command to add it to your project:

<CodeInTabs>
    <CodeTab title="npm" lang="bash">
        npm install --save @jitsu/eventnative
    </CodeTab>
    <CodeTab title="yarn" lang="javascript">
        yarn add
    </CodeTab>
</CodeInTabs>

To initialize **EventNative**, please use:

```javascript
const { eventN } = require('@jitsu/eventnative');
eventN.init({
    key: "[API_KEY]",
    ...params
});
```
<Hint>
    <a href="/docs/sending-data/javascript-reference/initialization-parameters">Please see the full list of parameters</a>, a <b>key</b> parameter value is required.
</Hint>

### Intercepting Segment events

To intercept Segment event it's recommended to initialize interception explicitly rather than use [segment_hook](/docs/sending-data/javascript-reference/initialization-parameters) parameter:

```javascript

    eventN.init({...});

    //Create analytics via npm module
    const analytics = new Analytics();
    //initialize interception explicitely
    eventN.interceptAnalytics(analytics);

```




# jitsu-react


[![NPM](https://img.shields.io/npm/v/@jitsu/jitsu-react.svg)](https://www.npmjs.com/package/@jitsu/jitsu-react)

## Install

```bash
npm install --save @jitsu/jitsu-react
```

## Usage

To setup Jitsu-React library you need to add `JitsuProvider` component close to the root level of your app:

```tsx
import React from "react";
import { JitsuProvider } from "@jitsu/jitsu-react";

export default function App() {
  return <JitsuProvider options={{ host: "https://<id>.d.jitsu.com" }}>
    <Page />
  </JitsuProvider>;
}
```

Then use `useJitsu` hook in components where you want to track events.

```tsx
import * as React from "react";
import { useJitsu } from "@jitsu/jitsu-react";
import { useEffect } from "react";

export default function Page() {
  const { analytics } = useJitsu();
  useEffect(() => {
    // Track page view
    analytics.track("event", { prop: "value" });
  }, [location]);

  return (
    <div>
      <button onClick={() => analytics.track("button-click")}>Click me!</button>
    </div>
  );
}
```

As `location` you should use an value that changes on every navigation. Examples:
 * React Router: `useLocationHook()`
 * Next.js: `const rounter = useRouter()`; then `router.asPath`
 * Others: `[window.location.pathname, window.location.search, window.location.hash]`

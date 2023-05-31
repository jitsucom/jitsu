import * as React from "react";
import { JitsuProvider } from "@jitsu/jitsu-react";
import Page from "./Page";
import ConfigurationProvider, { useJitsuUrl } from "./ConfigurationProvider";
import "./Page.css";

// export const ConfigComponent: React.FC<{}> = {
//
// }

function ReactExample() {
  const useJitsuURL = useJitsuUrl();
  return (
    <JitsuProvider options={{ host: useJitsuURL, debug: true }}>
      <div className={"max-w-4xl  mx-auto border p-12"}>
        <h1>Jitsu React Example</h1>
        <ExampleDescription />
        <br />
        (It is recommended to set to working one)
        <br />
        <Page />
      </div>
    </JitsuProvider>
  );
}

export default function App() {
  return (
    <ConfigurationProvider>
      <ReactExample />
    </ConfigurationProvider>
  );
}

function ExampleDescription() {
  return (
    <>
      This is a basic example of how to use Jitsu with React App.
      <br />
      <p>
        To setup Jitsu-React library you need to add <code>JitsuProvider</code> component close to the root level of
        your app and then use <code>useJitsu</code> hook in components where you want to track events:
        <pre>
          {[
            "function App() {",
            "   return <JitsuProvider options={{host: '....'}}>",
            "       <AppComponents />",
            "   </JitsuProvider>",
            "}",
            "",
            "function InsideComponent() {",
            "   const { analytics } = useJitsu();",
            "   return <button onClick={() => analytics.track('button-click')}>Click me</button>",
            "}",
          ].join("\n")}
        </pre>
      </p>
    </>
  );
}

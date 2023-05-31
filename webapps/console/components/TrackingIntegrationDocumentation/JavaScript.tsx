import { jsConfigParams } from "./params";
import { CodeBlock } from "../CodeBlock/CodeBlock";
import { Callout } from "../Callout/Callout";

function getExampleJsonConfig() {
  return JSON.stringify(
    jsConfigParams.map(({ name }) => [name, "..."]).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
    null,
    2
  );
}

export const JavaScriptManual: React.FC<{ domain: string; writeKey?: string }> = ({ domain, writeKey }) => {
  return (
    <div className="py-8 px-6 flex justify-center">
      <div className="prose max-w-6xl w-full ">
        <h1>Tracking Events with NPM package</h1>
        <p>
          <code>@jitsu/js</code> is an NPM package that allows you to track events from your JavaScript code. The
          package is isomorphic and can be used in both browser and Node.js environments.
        </p>
        <h2>Installation</h2>
        <CodeBlock>npm install @jitsu/js</CodeBlock>
        <h2>Usage</h2>
        <CodeBlock lang="tsx">
          {[
            `export async function track() {`,
            `   const analytics = jitsuAnalytics({`,
            `      host: "${domain}",`,
            `      ${
              writeKey
                ? "//For browser, use browser write key"
                : "//For browser, write key is not required, individual tracking host is enough"
            }`,
            `      //For nodejs, use a server write key from JS settings`,
            `      writeKey: "",`,
            `   });`,
            `   await analytics.identify("userId", {email: "test", anyOtherProperty: "value"});`,
            `   await analytics.track("test page", { pageProperty: "propValue" });`,
            `   await analytics.page("test", { a: 1 });`,
            `}`,
          ].join("\n")}
        </CodeBlock>
        <p>
          <Callout variant={"info"}>
            In browser, page properties such as title, location will be detected automatically. In Node.js, you need to
            provide them manually. See <code>RuntimeFacade</code> interface. Provide you own implementation of
            `RuntimeFacade` for nodejs
          </Callout>
        </p>
      </div>
    </div>
  );
};

import { branding } from "../../lib/branding";
import { CodeBlock } from "../CodeBlock/CodeBlock";
import { Callout } from "../Callout/Callout";
import { WLink } from "../Workspace/WLink";

export const Segment: React.FC<{ domain: string }> = ({ domain }) => {
  return (
    <div className="py-8 px-6 flex justify-center">
      <div className="prose max-w-6xl w-full">
        <h1>If you're already using Segment</h1>
        <p>
          If you're using Segment to collect data from your website, you can use our Segment integration to send data to{" "}
          {branding.productName}
        </p>
        <h2>For analytics.js (Server-side usage)</h2>
        <CodeBlock lang="js">
          {[
            `import Analytics from 'analytics'`,
            `import segmentPlugin from '@analytics/segment'`,
            `const analytics = Analytics({`,
            `   plugins: [`,
            `      segmentPlugin({`,
            `         host: '${domain}/sg',`,
            `         writeKey: '123-xyz'`,
            `      })`,
            `   ]`,
            `})`,
            `analytics.page();`,
          ].join("\n")}
        </CodeBlock>
        <h2>For analytics.js (Browser usage)</h2>
        <CodeBlock lang="js">
          {[
            `import Analytics from 'analytics'`,
            `import segmentPlugin from '@analytics/segment'`,
            `const analytics = Analytics({`,
            `   plugins: [`,
            `      segmentPlugin({`,
            `         customScriptSrc: '${domain}/p.js',`,
            `         writeKey: '123-xyz'`,
            `      })`,
            `   ]`,
            `})`,
            `analytics.page();`,
          ].join("\n")}
        </CodeBlock>
        {/*<h2>For analytics.js 2.0</h2> - Analytics 2.0 doesn't have a good documentation on plugins,
        and it's hard to come up with a good example*/}
        <p>
          <Callout variant="tip">
            If you want {branding.productName} to proxy your Segment calls, you can use{" "}
            <WLink href={`/destinations?id=new&destinationType=segment-proxy`}>Segment proxy destination</WLink>
          </Callout>
        </p>
      </div>
    </div>
  );
};

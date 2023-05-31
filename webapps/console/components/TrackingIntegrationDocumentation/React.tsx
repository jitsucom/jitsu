import { branding } from "../../lib/branding";
import { CodeBlock } from "../CodeBlock/CodeBlock";

export const ReactManual: React.FC<{ domain: string; writeKey?: string }> = ({ domain, writeKey }) => {
  return (
    <div className="py-8 px-6 flex justify-center">
      <div className="prose max-w-6xl w-full">
        <h1>Tracking Events with React</h1>
        <h2>Setup</h2>
        <p>
          Start with adding dependency to your project: <code>npm install {branding.npmNamespace}/jitsu-react</code>.
          Then add{" "}
          <code>
            {"<"}JitsuProvider{" />"}
          </code>{" "}
          component close to the root level of your app:
        </p>
        <CodeBlock lang="tsx">
          {[
            `import React, { Component } from 'react'`,
            `import { JitsuProvider } from "@jitsu/jitsu-react";`,
            ``,
            `function App() {`,
            `  return (`,
            `    <JitsuProvider options={{ host: "${domain}"${writeKey ? `, writeKey: "${writeKey}"` : ""} }} >`,
            `      <ChildComponent />`,
            `    </JitsuProvider>`,
            `  );`,
            `}`,
          ].join("\n")}
        </CodeBlock>
        <h2>Manual event tracking</h2>
        <p>
          Call <code>use{branding.productName}</code> hook whenever you need manually trigger events object:
        </p>
        <CodeBlock lang="tsx">
          {[
            `import { use${branding.productName} } from "${branding.npmNamespace}/jitsu-react"`,
            ``,
            `function ChildComponent() {`,
            `  const { analytics } = use${branding.productName}()`,
            `  return <button onClick={() => analytics.track('click')}>Click Me!</button>`,
            `}`,
          ].join("\n")}
        </CodeBlock>
        <h2>
          Automatic <code>page</code> event tracking
        </h2>
        <p>
          {branding.productName} can automatically track <code>page</code> events when user navigates to a new page:
        </p>
        <h3>With react-router:</h3>
        <CodeBlock lang="tsx">
          {[
            `import { use${branding.productName} } from "${branding.npmNamespace}/jitsu-react"`,
            `import { useLocation } from "react-router-dom"`,
            "",
            `function ChildComponent() {`,
            `  const { analytics } = use${branding.productName}()`,
            `  const location = useLocation()`,
            `  return useEffect(() => {`,
            `    analytics.page()`,
            `  }, [location])`,
            `}`,
          ].join("\n")}
        </CodeBlock>
        <h3>With Next.js:</h3>
        <CodeBlock lang="tsx">
          {[
            `import { use${branding.productName} } from "${branding.npmNamespace}/jitsu-react"`,
            `import { useRouter } from "next/router"`,
            "",
            `function ChildComponent() {`,
            `  const { analytics } = use${branding.productName}()`,
            `  const router = useRouter()`,
            `  return useEffect(() => {`,
            `    analytics.page()`,
            `  }, [router.asPath])`,
            `}`,
          ].join("\n")}
        </CodeBlock>
      </div>
    </div>
  );
};

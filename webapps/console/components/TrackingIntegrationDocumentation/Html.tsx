import { branding } from "../../lib/branding";
import { CodeBlock } from "../CodeBlock/CodeBlock";
import { camelSplit, indentCode } from "../../lib/code";
import { jsConfigParams } from "./params";

function getExampleJsonConfig() {
  return JSON.stringify(
    jsConfigParams.map(({ name }) => [name, "..."]).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
    null,
    2
  );
}

export const HtmlManual: React.FC<{ domain: string; writeKey?: string }> = ({ domain, writeKey }) => {
  const gVar = branding.productName.toLowerCase();
  return (
    <div className="py-8 px-6 flex justify-center">
      <div className="prose max-w-6xl w-full ">
        <h1>Tracking Events with HTML snippet</h1>
        <p>
          To start tracking events with <strong>{branding.productName}</strong> just add following snippet to{" "}
          <code>{"<head>"}</code> section of your website
        </p>
        <CodeBlock lang="html">{`<script async src="${domain}/p.js"${
          writeKey ? ` data-write-key="${writeKey}"` : ""
        }></script>`}</CodeBlock>
        <h2>Configuration</h2>
        <p>
          You can configure <strong>{branding.productName}</strong> by adding <code>data-*</code> attributes to the
          script tag. Example:
        </p>
        <CodeBlock lang="html">{`<script async src="${domain}/p.js" data-user-id="X"${
          writeKey ? ` data-write-key="${writeKey}"` : ""
        }></script>`}</CodeBlock>
        List of available configuration options:
        <table className="table-auto">
          <thead>
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {jsConfigParams.map(param => (
              <tr key={param.name}>
                <td className="border border-textLight px-4 py-2">
                  <code>{["data", ...camelSplit(param.name)].join("-")}</code>
                </td>
                <td className="border border-textLight px-4 py-2">{param.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Alternatively you can define <code>window.{gVar}Config</code> object before inserting the snippet. Properties
          of the object be same as data attributes, but camel cased and without <code>data-</code> prefix:
        </p>
        <CodeBlock lang="html">
          {[
            `<script>`,
            indentCode(`window.${gVar}Config = ${getExampleJsonConfig()}`, 2),
            `</script>`,
            `<script async src="${domain}/p.js"></script>`,
          ].join("\n")}
        </CodeBlock>
        <h2>
          <code>onload</code> hook
        </h2>
        <p>
          You can specify a piece of code that will be executed after the script has loaded. This can be useful if you
          want to send additional events or identify user. Example:
        </p>
        <CodeBlock lang="html">
          {[
            `<script type="text/javascript">`,
            indentCode(
              [
                `window.${gVar}Loaded = function(${gVar}) {`,
                indentCode(
                  [
                    `${gVar}.identify("X", {email: "john.doe@gmail.com"})`,
                    `${gVar}.track("customEvent", {customParam: Y})`,
                  ].join("\n"),
                  2
                ),
                `}`,
              ].join("\n"),
              2
            ),
            `</script>`,
            `<script async src="${domain}/p.js" data-onload="${gVar}Loaded"></script>`,
          ].join("\n")}
        </CodeBlock>
        <p>
          <code>{gVar}</code> variable implements a standard segment-compatible tracking interfaces{" "}
        </p>
      </div>
    </div>
  );
};

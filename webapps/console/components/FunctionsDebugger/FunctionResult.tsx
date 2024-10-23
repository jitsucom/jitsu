import React from "react";
import { Htmlizer } from "../Htmlizer/Htmlizer";
import { DropRetryErrorName, RetryErrorName } from "@jitsu/functions-lib";
import { CodeEditor } from "../CodeEditor/CodeEditor";
import Convert from "ansi-to-html";
const convert = new Convert({ newline: true });

export const FunctionResult: React.FC<{ resultType: "ok" | "drop" | "error"; result: any; className?: string }> = ({
  result,
  resultType,
  className,
}) => {
  return (
    <div className={`${className ?? ""} flex-auto h-full bg-backgroundLight w-full pl-2`}>
      {resultType === "error" && (
        <div className={"font-mono p-2 text-xs"}>
          <Htmlizer>
            {`<span class="text-red-600"><b>${result.name}:</b></span> ` +
              convert.toHtml(result.message.replaceAll(" ", "&nbsp;"))}
          </Htmlizer>
          {result.name === DropRetryErrorName && (
            <div className={"pt-1"}>
              If such error will happen on an actual event, it will be <b>SKIPPED</b> and retry will be scheduled in{" "}
              {result.retryPolicy?.delays?.[0] ? Math.min(result.retryPolicy.delays[0], 1440) : 5} minutes.
            </div>
          )}
          {result.name === RetryErrorName && (
            <div className={"pt-1"}>
              If such error will happen on an actual event, this function will be scheduled
              <br />
              for retry in {result.retryPolicy?.delays?.[0] ? Math.min(result.retryPolicy.delays[0], 1440) : 5} minutes,
              but event will be processed further.
            </div>
          )}
        </div>
      )}
      {resultType === "drop" && (
        <div className={"font-mono p-2 text-xs"}>
          Further processing will be <b>SKIPPED</b>. Function returned: <code>{JSON.stringify(result)}</code>.
        </div>
      )}
      {resultType === "ok" && (
        <CodeEditor
          width={"99.9%"}
          height={"99.9%"}
          language={typeof result !== "string" ? "json" : "text"}
          value={typeof result !== "string" ? JSON.stringify(result, null, 2) : result}
          onChange={s => {}}
          monacoOptions={{
            renderLineHighlight: "none",
            lineDecorationsWidth: 8,
            lineNumbers: "off",
            readOnly: true,
            folding: false,
          }}
        />
      )}
    </div>
  );
};

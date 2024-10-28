import React, { useState } from "react";
import { CodeBlockLight } from "../CodeBlock/CodeBlockLight";

export const CodeViewer: React.FC<{ code: string }> = ({ code }) => {
  const [showCode, setShowCode] = useState(false);

  return (
    <div>
      <button className="text-primary" onClick={() => setShowCode(!showCode)}>
        {showCode ? "Hide code" : "View compiled code"} »
      </button>
      {showCode && (
        <CodeBlockLight
          className="mt-2 bg-background text-xs py-2 px-3 rounded-lg max-h-60 overflow-y-auto "
          lang="javascript"
        >
          {code}
        </CodeBlockLight>
      )}
    </div>
  );
};

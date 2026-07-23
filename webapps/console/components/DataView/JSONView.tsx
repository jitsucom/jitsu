import React, { useState } from "react";
import { Button } from "antd";
import { CopyOutlined, FileTextOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import { CodeBlockLight } from "../CodeBlock/CodeBlockLight";

const ReactJson = dynamic(() => import("react-json-view"), { ssr: false });

export const JSONView = (props: { data: any; rawData?: string }) => {
  const [raw, setRaw] = useState(false);

  const toggleRaw = () => {
    setRaw(!raw);
  };

  const copyToClipboard = () => {
    if (raw) {
      navigator.clipboard.writeText(
        typeof props.rawData === "string" ? props.rawData : JSON.stringify(props.data, undefined, "  ")
      );
    } else {
      navigator.clipboard.writeText(JSON.stringify(props.data, null, 2));
    }
  };

  return (
    <div className={"relative"}>
      <div className={"absolute right-0 top-0 z-50"}>
        <div className={"flex flex-row gap-2"}>
          {!raw ? (
            <Button icon={<FileTextOutlined />} onClick={toggleRaw}>
              Raw data
            </Button>
          ) : (
            <Button icon={<FileTextOutlined />} onClick={toggleRaw}>
              JSON
            </Button>
          )}
          <Button icon={<CopyOutlined />} onClick={copyToClipboard}>
            Copy
          </Button>
        </div>
      </div>
      {!raw ? (
        <ReactJson enableClipboard={false} displayObjectSize={false} displayDataTypes={false} src={props.data} />
      ) : (
        <>
          <CodeBlockLight lang="json">{props.rawData ?? JSON.stringify(props.data, undefined, "  ")}</CodeBlockLight>
        </>
      )}
    </div>
  );
};

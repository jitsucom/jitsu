import React, { useState } from "react";
import { Button, Space } from "antd";
import { CopyOutlined, FileTextOutlined } from "@ant-design/icons";
import loadable from "@loadable/component";
import { CodeBlockLight } from "../CodeBlock/CodeBlockLight";

const ReactJson = loadable(() => new Promise((r, c) => import("react-json-view").then(result => r(result.default), c)));

export const JSONView = (props: { data: any; rawData?: string }) => {
  const [raw, setRaw] = useState(false);

  const toggleRaw = () => {
    setRaw(!raw);
  };

  const copyToClipboard = () => {
    if (raw) {
      navigator.clipboard.writeText(props.rawData ?? "");
    } else {
      navigator.clipboard.writeText(JSON.stringify(props.data, null, 2));
    }
  };

  return (
    <div className={"relative"}>
      <div className={"absolute right-0 top-0 z-50"}>
        <Space>
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
        </Space>
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

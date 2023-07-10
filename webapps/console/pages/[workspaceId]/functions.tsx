import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../components/ConfigObjectEditor/ConfigEditor";
import { FunctionConfig } from "../../lib/schema";
import { useWorkspace } from "../../lib/context";
import { useRouter } from "next/router";
import { getLog } from "juava";
import React from "react";
import { FunctionSquare } from "lucide-react";
import { Tooltip } from "antd";
import { FunctionsDebugger } from "../../components/FunctionsDebugger/FunctionsDebugger";

const log = getLog("functions");

const Functions: React.FC<any> = () => {
  const router = useRouter();
  console.log("router", router.pathname);
  return (
    <WorkspacePageLayout
      className={`${
        router.pathname === "/[workspaceId]/functions" && typeof router.query["id"] !== "undefined" ? "h-screen" : ""
      }`}
      fullscreen={router.pathname === "/[workspaceId]/functions" && typeof router.query["id"] !== "undefined"}
    >
      <FunctionsList />
    </WorkspacePageLayout>
  );
};

export const FunctionTitle: React.FC<{
  f?: FunctionConfig;
  size?: "small" | "default" | "large";
  title?: (d?: FunctionConfig) => string;
}> = ({ f, title = d => d?.name ?? "function", size = "default" }) => {
  const iconClassName = (() => {
    switch (size) {
      case "small":
        return "h-4 w-4";
      case "large":
        return "h-16 w-16";
      default:
        return "h-8 w-8";
    }
  })();
  return (
    <div className={"flex flex-row items-center gap-2"}>
      <div className={iconClassName}>
        <FunctionSquare size={18} />
      </div>
      <div>
        <Tooltip title={f?.description}>{title(f)}</Tooltip>
      </div>
    </div>
  );
};

const FunctionsList: React.FC<{}> = () => {
  const router = useRouter();
  const workspace = useWorkspace();
  const config: ConfigEditorProps<FunctionConfig> = {
    listColumns: [
      {
        title: "Description",
        render: (c: FunctionConfig) => <>{c.description ?? ""}</>,
      },
    ],
    editorComponent: () => FunctionsDebugger,
    objectType: FunctionConfig,
    fields: {
      type: { constant: "function" },
      workspaceId: { constant: workspace.id },
      code: { textarea: true },
    },
    noun: "function",
    type: "function",
    explanation: (
      <div>
        <strong>Functions</strong> let you apply transformations to incoming events. Examples of such transformations
        are:
        <ul>
          <li>
            <b>Change structure of events</b>. rename fields, fix data errors etc
          </li>
          <li>
            <b>Filtering</b>. Rename fields, fix data errors etc
          </li>
          <li>
            <b>Sending data to exteral services</b>. Functions support <code>fetch</code> API
          </li>
        </ul>
        <p>
          Functions are written in JavaScript or TypeScript. You can use <code>fetch</code> and bundled key-value
          storage for caching / state management
        </p>
      </div>
    ),
    editorTitle: (obj: FunctionConfig, isNew: boolean) => {
      const verb = isNew ? "Create" : "Edit";
      return (
        <div className="flex items-center">
          <div className="h-12 mr-4">{<FunctionSquare size={42} />}</div>
          {verb} function
        </div>
      );
    },
  };
  return (
    <>
      <ConfigEditor {...(config as any)} />
    </>
  );
};

export default Functions;

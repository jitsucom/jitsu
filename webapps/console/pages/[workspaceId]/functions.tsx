import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../components/ConfigObjectEditor/ConfigEditor";
import { FunctionConfig } from "../../lib/schema";
import { useWorkspace } from "../../lib/context";
import { useRouter } from "next/router";
import { getLog } from "juava";
import React from "react";
import { FunctionSquare } from "lucide-react";
import { FunctionsDebugger } from "../../components/FunctionsDebugger/FunctionsDebugger";
import { ObjectTitle } from "../../components/ObjectTitle/ObjectTitle";

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
  title?: (d?: FunctionConfig) => string | React.ReactNode;
}> = ({ f, title = d => d?.name ?? "function", size = "default" }) => {
  return (
    <ObjectTitle
      icon={<FunctionSquare className={"text-text w-full h-full"} />}
      size={size}
      title={f ? title(f) : "Unknown function"}
    />
  );
};

const FunctionsList: React.FC<{}> = () => {
  const router = useRouter();
  const workspace = useWorkspace();
  const config: ConfigEditorProps<FunctionConfig> = {
    editorComponent: () => FunctionsDebugger,
    objectType: FunctionConfig,
    fields: {
      type: { constant: "function" },
      workspaceId: { constant: workspace.id },
      code: { textarea: true },
    },
    noun: "function",
    type: "function",
    newObject: () => ({ name: "New function" }),
    icon: f => <FunctionSquare className={"text-text"} />,
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

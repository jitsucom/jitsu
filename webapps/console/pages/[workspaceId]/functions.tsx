import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../components/ConfigObjectEditor/ConfigEditor";
import { FunctionConfig } from "../../lib/schema";
import { useWorkspace } from "../../lib/context";
import { useRouter } from "next/router";
import { getLog } from "juava";
import React from "react";
import { FunctionSquare, HardDrive } from "lucide-react";
import { FunctionsDebugger } from "../../components/FunctionsDebugger/FunctionsDebugger";
import { ObjectTitle } from "../../components/ObjectTitle/ObjectTitle";
import Link from "next/link";

const log = getLog("functions");

const Functions: React.FC<any> = () => {
  const router = useRouter();
  const editor = router.pathname === "/[workspaceId]/functions" && typeof router.query["id"] !== "undefined";
  return (
    <WorkspacePageLayout contentClassName={editor ? "!py-6" : ""} screen={editor}>
      <FunctionsList />
    </WorkspacePageLayout>
  );
};

export const FunctionTitle: React.FC<{
  f?: FunctionConfig;
  size?: "small" | "default" | "large";
  showDescription?: boolean;
  title?: (d?: FunctionConfig) => string | React.ReactNode;
}> = ({ f, title, showDescription, size = "default" }) => {
  let titleNode: string | React.ReactNode = "unknown function";
  if (title) {
    titleNode = title(f);
  } else if (f?.name) {
    if (showDescription && f?.description) {
      titleNode = (
        <>
          <h2>{f?.name}</h2>
          <div className="pt-0.5 text-xs text-gray-500 font-normal whitespace-break-spaces">{f?.description}</div>
        </>
      );
    } else {
      titleNode = f?.name;
    }
  }
  return (
    <ObjectTitle
      icon={f ? <FunctionSquare className={"text-text w-full h-full"} /> : undefined}
      size={size}
      title={titleNode}
    />
  );
};

const FunctionsList: React.FC<{}> = () => {
  const router = useRouter();
  const workspace = useWorkspace();
  const config: ConfigEditorProps<FunctionConfig> = {
    editorComponent: () => FunctionsDebugger,
    objectType: FunctionConfig,
    filter: (f: FunctionConfig) => !f.kind || f.kind !== "profile",
    fields: {
      type: { constant: "function" },
      workspaceId: { constant: workspace.id },
      cloneId: { hidden: true },
      updatedAt: { hidden: true },
      code: { textarea: true },
    },
    noun: "function",
    listColumns: [
      {
        title: "name",
        render: (f: FunctionConfig) => {
          return (
            <Link className="flex items-center text-text" href={`/${workspace.slugOrId}/functions?id=${f.id}`}>
              <FunctionTitle
                f={f}
                title={() => (
                  <>
                    <div className={"flex gap-1"}>
                      <h2>{f.name}</h2>
                      {f.origin === "jitsu-cli" && (
                        <div className="bg-background border border-backgroundDark px-0.5 py-0.2 rounded textLight flex items-center gap-1 ml-2 text-text">
                          <HardDrive className="w-3 h-3" />
                          <span className="font-mono text-xxs text-text font-light">deployed from CLI</span>
                        </div>
                      )}
                    </div>
                    {f.description && (
                      <div className="pt-0.5 text-xs text-gray-500 font-normal whitespace-break-spaces">
                        {f.description}
                      </div>
                    )}
                  </>
                )}
              />
            </Link>
          );
        },
      },
    ],

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

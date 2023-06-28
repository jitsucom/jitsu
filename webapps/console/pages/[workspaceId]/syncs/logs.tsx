import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import React, { useEffect, useState } from "react";
import { useApi } from "../../../lib/useApi";
import { useRouter } from "next/router";
import { LoadingAnimation } from "../../../components/GlobalLoader/GlobalLoader";
import { ErrorCard } from "../../../components/GlobalError/GlobalError";
import { JitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { ChevronLeft, FileDown, RefreshCw } from "lucide-react";

function TaskLogs() {
  const router = useRouter();
  const workspace = useWorkspace();
  const divRef = React.useRef<HTMLDivElement>(null);

  const [refresh, setRefresh] = useState(0);

  let logsUrl = `/api/${workspace.id}/sources/logs?syncId=${router.query.syncId}&taskId=${router.query.taskId}&refresh=${refresh}`;

  const { isLoading, data, error } = useApi(logsUrl);

  // Paint lines with ERROR in red
  const coloredData = data?.split("\n").map((line, i) => {
    if (line.includes(" ERROR [")) {
      return (
        <span key={i} className="text-red-600">
          {line + "\n"}
        </span>
      );
    } else if (line.includes(" WARN [")) {
      return (
        <span key={i} className="text-yellow-800">
          {line + "\n"}
        </span>
      );
    } else {
      return (
        <span
          key={i}
          dangerouslySetInnerHTML={{
            __html:
              line.replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.]\d{3})/, '<span style="color: #4f46e5">$1</span>') +
              "\n",
          }}
        ></span>
      );
    }
  });

  useEffect(() => {
    if (divRef.current) {
      divRef.current.scrollTop = divRef.current.scrollHeight;
    }
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      <div className="mt-4 mb-4 flex flex-row justify-between">
        <h1 className="text-3xl">Sync Tasks</h1>
        <div>
          <JitsuButton
            icon={<FileDown className="w-6 h-6" />}
            type="link"
            size="small"
            target="_blank"
            href={logsUrl + "&download=true"}
          >
            Download
          </JitsuButton>
          <JitsuButton
            icon={<RefreshCw className="w-6 h-6" />}
            type="link"
            size="small"
            onClick={() => {
              setRefresh(refresh + 1);
            }}
          >
            Refresh
          </JitsuButton>
          <JitsuButton
            icon={<ChevronLeft className="w-6 h-6" />}
            type="link"
            size="small"
            onClick={() => router.back()}
          >
            Back
          </JitsuButton>
        </div>
      </div>
      {(function () {
        if (isLoading) {
          return <LoadingAnimation className={"h-full"} />;
        } else if (error) {
          return <ErrorCard error={error} />;
        } else {
          return (
            <div
              ref={divRef}
              className={
                "bg-background border text-sm rounded-lg p-3 overflow-y-auto w-full whitespace-pre-wrap break-words font-mono"
              }
            >
              {coloredData}
            </div>
          );
        }
      })()}
    </div>
  );
}

const TasksPage = () => {
  return (
    <WorkspacePageLayout className={"h-screen"}>
      <TaskLogs />
    </WorkspacePageLayout>
  );
};
export default TasksPage;

import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import React, { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { JitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { ChevronLeft, FileDown, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { LoadingAnimation } from "../../../components/GlobalLoader/GlobalLoader";

function colorLogs(data: string): ReactNode {
  return data.split("\n").map((line, i) => {
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
}

function TaskLogs() {
  const router = useRouter();
  const workspace = useWorkspace();
  const divRef = React.useRef<HTMLDivElement>(null);
  const originalRefresh = useMemo(() => new Date(), []);
  const [refresh, setRefresh] = React.useState(originalRefresh);

  let logsUrl = `/api/${workspace.id}/sources/logs?syncId=${router.query.syncId}&taskId=${router.query.taskId}`;
  const { isLoading, data, error } = useQuery(
    ["taskLog", router.query.taskId, refresh],
    async () => {
      const res = await fetch(logsUrl);
      return res.text();
    },
    { cacheTime: 0, retry: false }
  );

  const [displayText, setDisplayText] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (divRef.current) {
      divRef.current.scrollTop = divRef.current.scrollHeight;
    }
  }, [displayText]);

  useEffect(() => {
    if (data) {
      setDisplayText(data);
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
            icon={<RefreshCw className={`w-6 h-6 ${isLoading && originalRefresh !== refresh && "animate-spin"}`} />}
            type="link"
            size="small"
            onClick={async () => {
              setRefresh(new Date());
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
      <div
        ref={divRef}
        className={`bg-background border text-sm rounded-lg p-3 overflow-y-auto w-full grow whitespace-pre-wrap break-words font-mono ${
          isLoading && originalRefresh != refresh && "opacity-50"
        }`}
      >
        <>
          {isLoading && originalRefresh == refresh && (
            <div className="flex justify-center items-center w-full h-full">
              <LoadingAnimation />
            </div>
          )}
          {error && <div>Error: {JSON.stringify(error)}</div>}
          {displayText && colorLogs(displayText)}
        </>
      </div>
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

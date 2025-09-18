import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import React, { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { JitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { FileDown, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { LoadingAnimation } from "../../../components/GlobalLoader/GlobalLoader";
import escape from "lodash/escape";
import { BackButton } from "../../../components/BackButton/BackButton";

function colorLogs(data: string[]): ReactNode {
  return data.map((line, i) => {
    line = escape(line);
    if (line.includes(" ERROR [") || line.includes(" FATAL [") || line.includes(" ERRSTD [")) {
      return (
        <span
          key={i}
          className="text-red-600"
          dangerouslySetInnerHTML={{
            __html: line + "\n",
          }}
        />
      );
    } else if (line.includes(" WARN [")) {
      return (
        <span
          key={i}
          className="text-orange-800"
          dangerouslySetInnerHTML={{
            __html: line + "\n",
          }}
        />
      );
    } else if (line.includes("[jitsu]")) {
      return (
        <span
          key={i}
          className="text-fuchsia-700"
          dangerouslySetInnerHTML={{
            __html:
              line.replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.]\d{3})/, '<span style="color: #4f46e5">$1</span>') +
              "\n",
          }}
        ></span>
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

  const [displayText, setDisplayText] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    if (divRef.current) {
      divRef.current.scrollTop = divRef.current.scrollHeight;
    }
  }, [displayText]);

  useEffect(() => {
    if (data) {
      setDisplayText(data.split("#ENDLINE#").reverse());
    }
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 flex flex-row justify-between">
        <h1 className="text-3xl">Sync Logs</h1>
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
          <BackButton href={`/${workspace.slugOrId}/syncs/tasks?query={syncId:'${router.query.syncId}'}`} />
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

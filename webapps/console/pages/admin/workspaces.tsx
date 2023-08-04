import { useApi } from "../../lib/useApi";
import { useRouter } from "next/router";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { Loader2 } from "lucide-react";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { Switch } from "antd";
import omit from "lodash/omit";
import { JitsuButton } from "../../components/JitsuButton/JitsuButton";
import { FaArrowLeft } from "react-icons/fa";
import { useState } from "react";
import hash from "stable-hash";
import { JsonAsTable } from "../../components/JsonAsTable/JsonAsTable";

const View = ({ data }) => {
  const [rollup, setRollup] = useState(false);
  const router = useRouter();
  return (
    <div className="p-12">
      <div className="flex justify-between mb-12">
        <div className="flex space-x-2 items-center">
          <Switch onClick={val => setRollup(val)} /> <label>Rollup</label>
        </div>
        <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
          Go back
        </JitsuButton>
      </div>
      <JsonAsTable
        rows={(rollup
          ? Object.values(
              data.data.reduce((res, row) => {
                const rowKey = hash(omit(row, "events", "period"));
                const rowValues = omit(row, "period");
                if (!res[rowKey]) {
                  res[rowKey] = { ...rowValues, events: 0 };
                }
                res[rowKey].events += row.events;
                return res;
              }, {})
            )
          : data.data
        ).map(({ period, workspaceName, workspaceId, domains, workspaceSlug, events, ...rest }) => ({
          ...(period ? { period: new Date(period).toISOString().replace("T", " ") } : {}),
          ...{
            workspaceName: workspaceName || workspaceSlug || workspaceId,
            workspaceSlug: workspaceSlug || workspaceId,
            domains,
            ...rest,
            events,
          },
        }))}
        columnOptions={{
          src: { omit: true },
          workspaceId: { omit: true },
          users: { omit: true },
          events: { type: "number" },
          workspaceSlug: { omit: true },
          workspaceName: { type: "link", href: (val, row) => `/${row.workspaceSlug}` },
        }}
      />
    </div>
  );
};

export const WorkspacesAdminPage = () => {
  const { data, isLoading, error } = useApi(`/api/$all/ee/report/workspace-stat?extended=true`);
  const router = useRouter();
  const [filter, setFilter] = useQueryStringState("filter");
  if (isLoading) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <Loader2 className="h-16 w-16 animate-spin" />
      </div>
    );
  } else if (error) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <ErrorCard error={error} />
      </div>
    );
  }
  return <View data={data} />;
};

export default WorkspacesAdminPage;

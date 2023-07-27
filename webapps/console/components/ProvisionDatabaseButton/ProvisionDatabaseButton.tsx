import { useWorkspace } from "../../lib/context";
import { useApi } from "../../lib/useApi";
import React, { useState } from "react";
import { useRouter } from "next/router";
import { rpc } from "juava";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import LucideIcon from "../Icons/LucideIcon";

export function ProvisionDatabaseButton(props) {
  const { loader = undefined, createdCallback = undefined } = props;
  const workspace = useWorkspace();
  const url = `/api/${workspace.id}/ee/provision-db`;
  const { data, isLoading, error } = useApi(url);
  const [dbCreating, setDBCreating] = useState(false);
  const router = useRouter();
  const createDbHandler = async () => {
    setDBCreating(true);
    try {
      await rpc(url, { method: "POST", query: { workspaceId: workspace.id } });
      feedbackSuccess("Database created");
      if (createdCallback) {
        createdCallback();
      } else {
        router.reload();
      }
    } catch (e) {
      feedbackError("Error creating database", { error: e });
    } finally {
      setDBCreating(false);
    }
  };
  if (loader && isLoading) {
    return loader;
  }
  if (error || data === null || isLoading || data.provisioned == true) {
    //do nothing if:
    // a) ee is not available,
    // b) there is an error, or
    // c) the query is loading, we don't want to show the button
    // d) DB is already provisioned
    return <></>;
  }
  return (
    <div className="mt-8 border-textDisabled rounded-lg bg-backgroundLight px-4 py-5 flex items-center bg-neutral-50 border border-neutral-200 ">
      <div className="w-8 h-8 mr-4">
        <LucideIcon name={"database"} />
      </div>
      <div>
        <div className="text-xl text pb-2">Create FREE ClickHouse Warehouse</div>
        <div className="text pt-2 pb-4 text-textLight">
          Get a free ClickHouse Database, so you could start querying data instantly. ClickHouse is a open-source column
          oriented database. Jitsu runs ClickHouse in a fully managed mode, so you don't need to worry about
          infrastructure.
        </div>

        <JitsuButton
          icon={
            dbCreating ? (
              <LucideIcon name={"loader-2"} className="w-4 h-4 animate-spin" />
            ) : (
              <LucideIcon name={"plus"} className="w-4 h-4" />
            )
          }
          type="default"
          onClick={createDbHandler}
          disabled={dbCreating}
        >
          Create Database
        </JitsuButton>
      </div>
    </div>
  );
}

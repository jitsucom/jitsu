import { useRouter } from "next/router";
import { FaArrowLeft, FaPlus } from "react-icons/fa";
import { get, useApi } from "../lib/useApi";
import { z } from "zod";
import { WorkspaceDbModel } from "../prisma/schema";
import { ArrowRight, Loader2 } from "lucide-react";
import { EmbeddedErrorMessage } from "../components/GlobalError/GlobalError";
import { getLog } from "juava";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { firebaseSignOut } from "../lib/firebase-client";
import React, { ReactNode, useState } from "react";
import { feedbackError } from "../lib/ui";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { Badge, Input, Tag } from "antd";
import { useQueryStringState } from "../lib/useQueryStringState";

const log = getLog("worspaces");

const NewWorkspaceWrapper = (props: { children: ReactNode; isNew: boolean }) => {
  if (props.isNew) {
    return (
      <Badge.Ribbon text="Not configured" color="green">
        {props.children}
      </Badge.Ribbon>
    );
  } else {
    return <>{props.children}</>;
  }
};

const WorkspacesList = () => {
  const router = useRouter();
  const { data: userData } = useApi(`/api/user/properties`);
  const { data, isLoading, error } = useApi<z.infer<typeof WorkspaceDbModel>[]>(`/api/workspace`);
  const [filter, setFilter] = useQueryStringState("filter", { defaultValue: "", skipHistory: true });
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-fit">
        <Loader2 className="h-16 w-16 animate-spin" />
      </div>
    );
  } else if (error) {
    log.atError().withCause(error).log("Failed to load workspaces list");

    return (
      <div className="flex justify-center items-center h-full">
        <EmbeddedErrorMessage>Failed to load workspaces list</EmbeddedErrorMessage>
      </div>
    );
  } else if (data) {
    return (
      <div className="flex flex-col space-y-4 w-full mx-auto">
        {data.length > 5 && (
          <div key={"filter"}>
            <Input
              allowClear
              placeholder="Search"
              onChange={e => {
                setFilter(e.target.value);
              }}
              className="w-full border border-textDisabled rounded-lg px-4 py-4"
            />
          </div>
        )}
        {data
          .filter(
            w =>
              w.id.toLowerCase().includes(filter.toLowerCase()) ||
              w.name?.toLowerCase().includes(filter.toLowerCase()) ||
              w.slug?.toLowerCase().includes(filter.toLowerCase())
          )
          .map(workspace => (
            <Link
              className="border border-textDisabled rounded px-4 py-4 shadow hover:border-primaryDark hover:shadow-primaryLighter flex justify-between items-center hover:text-textPrimary group"
              key={workspace.slug || workspace.id}
              href={`/${workspace.slug || workspace.id}`}
            >
              <div className="flex items-center justify-start gap-2">
                <div>{workspace.name || workspace.slug || workspace.id}</div>
                <div className="text-textLight">/{workspace.slug || workspace.id}</div>
                {<Tag className="text-xs text-textLight">{workspace.id}</Tag>}
                {!workspace.slug && (
                  <Tag color="lime" className="text-xs text-textLight">
                    Not configured
                  </Tag>
                )}
              </div>
              <div className="invisible group-hover:visible">
                <ArrowRight className="text-primary" />
              </div>
            </Link>
          ))}
      </div>
    );
  }
  return <></>;
};

const WorkspaceSelectionPage = (props: any) => {
  const router = useRouter();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  return (
    <div>
      <div className="flex justify-center">
        <div className="px-4 py-6 flex flex-col items-stretch w-full" style={{ maxWidth: "1000px", minWidth: "300px" }}>
          <div className="flex justify-between items-center">
            <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
              Go back
            </JitsuButton>
            <JitsuButton
              size="large"
              type="default"
              onClick={async () => {
                setCreatingWorkspace(true);
                try {
                  const { id } = await get("/api/workspace", { method: "POST", body: {} });
                  await router.push(`/${id}`);
                } catch (e) {
                  feedbackError(`Can't create new workspace`, { error: e });
                } finally {
                  setCreatingWorkspace(false);
                }
              }}
              loading={creatingWorkspace}
              icon={<FaPlus />}
              disabled={creatingWorkspace}
            >
              New Workspace
            </JitsuButton>
          </div>
          <div className="w-full grow">
            <h1 className="flex-grow text-center text-3xl py-6">👋 Select workspace</h1>
            <WorkspacesList />
          </div>
        </div>
      </div>
      <div key="mistake" className="text-center my-4">
        Got here by mistake?{" "}
        <a
          className="cursor-pointer text-primary underline"
          onClick={async () => {
            //we can't use current session here, since the error can be originated
            //from auth layer. Try to logout using all methods
            signOut().catch(err => {
              log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
            });
            firebaseSignOut().catch(err => {
              log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
            });
          }}
        >
          Sign out
        </a>{" "}
      </div>
    </div>
  );
};
export default WorkspaceSelectionPage;

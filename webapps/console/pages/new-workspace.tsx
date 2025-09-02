import React from "react";
import { WorkspaceNameAndSlugEditor } from "../components/WorkspaceNameAndSlugEditor/WorkspaceNameAndSlugEditor";
import { useRouter } from "next/router";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { Button } from "antd";
import { useUserSessionControls } from "../lib/context";
import { FaArrowLeft, FaList } from "react-icons/fa";

export default function NewWorkspace() {
  const router = useRouter();
  const sessionControl = useUserSessionControls();

  const handleSuccess = ({ id }: { name: string; slug: string; id?: string }) => {
    if (id) {
      router.push(`/${id}`);
    }
  };

  return (
    <div className="min-h-screen bg-backgroundLight">
      <div className="flex justify-center">
        <div className="px-4 py-6 flex flex-col items-stretch w-full" style={{ maxWidth: "1000px", minWidth: "300px" }}>
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-4">
              <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
                Go back
              </JitsuButton>
              <Button
                type="text"
                size="small"
                className="text-textLight hover:text-textDark"
                onClick={sessionControl.logout}
              >
                Sign out
              </Button>
            </div>
            <JitsuButton
              size="large"
              type="default"
              onClick={async () => {
                await router.push("/workspaces");
              }}
              icon={<FaList />}
            >
              All Workspaces
            </JitsuButton>
          </div>

          <div className="flex items-center justify-center flex-1">
            <div className="max-w-2xl w-full">
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-textDark mb-2">Create Your Workspace</h1>
                <p className="text-text">Let's set up your workspace to get started with Jitsu</p>
              </div>

              <WorkspaceNameAndSlugEditor onSuccess={handleSuccess} onboarding={true} canEdit={true} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

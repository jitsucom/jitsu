import { FaArrowLeft } from "react-icons/fa";
import { Button, Input } from "antd";
import { useRouter } from "next/router";
import { useUser } from "../lib/context";
import { ApiKeysEditor } from "../components/ApiKeyEditor/ApiKeyEditor";
import { get, useApi } from "../lib/useApi";
import { useState } from "react";
import { ApiKey } from "../lib/schema";
import { feedbackError, feedbackSuccess, useUnsavedChanges } from "../lib/ui";
import { QueryResponse } from "../components/QueryResponse/QueryResponse";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";

function ApiKeys() {
  const apiRes = useApi<ApiKey[]>("/api/user/keys");
  const [newKeys, setNewKeys] = useState<ApiKey[]>();
  const [loading, setLoading] = useState(false);
  useUnsavedChanges(!!newKeys, { message: "You have unsaved changes. Are you sure you want to leave?" });
  return (
    <QueryResponse
      result={apiRes}
      errorTitle={"Failed to load API keys"}
      render={keys => (
        <>
          <div className="text-lg font-bold">API Keys</div>
          <ApiKeysEditor
            value={keys}
            onChange={k => {
              setNewKeys(k);
            }}
          />
          <div className="flex justify-end pt-6">
            <Button
              type="primary"
              loading={loading}
              disabled={!newKeys}
              onClick={async () => {
                if (newKeys) {
                  setLoading(true);
                  try {
                    await get("/api/user/keys", { method: "POST", body: newKeys });
                    setNewKeys(undefined);
                    await apiRes.reload();
                    feedbackSuccess(`API keys has been saved`);
                  } catch (e) {
                    feedbackError(`Failed to save API keys`);
                  } finally {
                    //await reload();
                    setLoading(false);
                  }
                }
              }}
            >
              Save
            </Button>
          </div>
        </>
      )}
    />
  );
}

const UserPage = (props: any) => {
  const router = useRouter();
  const user = useUser();
  return (
    <div className="flex justify-center">
      <div className="px-4 py-6 flex flex-col items-center w-full" style={{ maxWidth: "1000px", minWidth: "300px" }}>
        <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
          Go back
        </JitsuButton>
        <div className="w-full grow">
          <h1 className="flex-grow text-3xl py-6">User settings</h1>
          <div className="px-8 py-6 border border-textDisabled rounded-lg">
            <div className="text-lg font-bold">Email</div>
            <Input value={user.email} className="border-error" />
            <div className="text-textDisabled">
              You can't change email, since you logged in with an external user provider - {user.loginProvider}
            </div>
          </div>
          <div className="px-8 py-6 border border-textDisabled rounded-lg mt-6">
            <ApiKeys />
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserPage;

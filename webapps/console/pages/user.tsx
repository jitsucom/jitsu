import { FaArrowLeft } from "react-icons/fa";
import { Button, Input } from "antd";
import { useRouter } from "next/router";
import { useUser } from "../lib/context";
import { ApiKeysEditor } from "../components/ApiKeyEditor/ApiKeyEditor";
import { get, useApi } from "../lib/useApi";
import React, { useState } from "react";
import { ApiKey } from "../lib/schema";
import { feedbackError, feedbackSuccess, useUnsavedChanges } from "../lib/ui";
import { QueryResponse } from "../components/QueryResponse/QueryResponse";
import { JitsuButton } from "../components/JitsuButton/JitsuButton";
import { ButtonLabel } from "../components/ButtonLabel/ButtonLabel";
import { rpc } from "juava";

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

const ChangePassword: React.FC<{}> = () => {
  const [loading, setLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  let error: string | undefined = undefined;
  if (currentPassword && newPassword && confirmNewPassword) {
    if (newPassword !== confirmNewPassword) {
      error = "New password and confirm password do not match";
    } else if (newPassword.length < 8) {
      error = "Password must be at least 8 characters long";
    }
  }

  return (
    <div className="px-8 py-6 border border-textDisabled rounded-lg space-y-4 mt-6">
      <div className="text-lg font-bold">Change Password</div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Current password</label>
        <Input required type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">New password</label>
        <Input required type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Confirm password</label>
        <Input
          required
          type="password"
          value={confirmNewPassword}
          onChange={e => setConfirmNewPassword(e.target.value)}
        />
      </div>
      <div className={`text-xs text-error my-0 py-0 ${error ? "visible" : "invisible"}`}>{error || "-"}</div>
      <Button
        type="primary"
        disabled={!(currentPassword && newPassword && confirmNewPassword) || !!error}
        onClick={async () => {
          if (!loading) {
            try {
              setLoading(true);
              await rpc("/api/user/change-password", { body: { currentPassword, newPassword } });
              feedbackSuccess("Password has been changed");
            } catch (e: any) {
              feedbackError(`Failed to change password - ${e.message}`, e);
            } finally {
              setLoading(false);
            }
          }
        }}
      >
        <ButtonLabel loading={loading}>Save</ButtonLabel>
      </Button>
    </div>
  );
};

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
          {user.loginProvider === "credentials" && <ChangePassword />}
          <div className="px-8 py-6 border border-textDisabled rounded-lg mt-6">
            <ApiKeys />
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserPage;

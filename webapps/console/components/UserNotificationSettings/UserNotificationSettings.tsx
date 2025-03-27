import React, { useEffect, useState } from "react";
import { Button, Form, Input, Switch } from "antd";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import type { UserNotificationsPreferences } from "../../lib/server/user-preferences";
import { get, useApi } from "../../lib/useApi";
import { ErrorCard } from "../GlobalError/GlobalError";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { useUser, WorkspaceContext } from "../../lib/context";

export const UserNotificationSettings: React.FC<{
  className?: string;
  workspace?: WorkspaceContext;
}> = ({ className, workspace }) => {
  const {
    isLoading: loading,
    data,
    error,
  } = useApi<UserNotificationsPreferences>(
    `/api/user/notifications-settings${workspace ? `?workspaceId=${workspace.id}&mergeWithGlobal=true` : ""}`
  );
  const [notificationPreference, setNotificationPreference] = useState<UserNotificationsPreferences | undefined>(data);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const user = useUser();

  useEffect(() => {
    setNotificationPreference(data);
  }, [data]);

  if (error) {
    return <ErrorCard error={error} title="Failed to load User Notification Settings" />;
  } else if (loading) {
    return <LoadingAnimation />;
  }
  return (
    // px-8 py-6 border border-textDisabled rounded-lg
    <div className={`${className ?? ""}`}>
      <Form
        form={form}
        disabled={loading || saving}
        initialValues={data}
        onValuesChange={async newValues => {
          console.log("newValues", newValues);
          setNotificationPreference({ ...notificationPreference, ...newValues });
        }}
      >
        <div className="flex flex-col mt-4 w-full">
          <div className="flex flex-row w-full justify-between items-center border rounded-t-lg p-4">
            <label htmlFor="batches" className="font-main flex flex-col gap-1">
              Events Batches statuses
              <span className="text-xs text-textLight">
                Send email reports on events batch processing failures and recoveries.
              </span>
            </label>
            <Form.Item name="batches" noStyle>
              <Switch id="batches" />
            </Form.Item>{" "}
          </div>
          <div className="flex flex-row w-full justify-between items-center border-x border-collapse p-4">
            <label htmlFor="syncs" className="font-main flex flex-col gap-1">
              Connector Sync statuses
              <span className="text-xs text-textLight">
                Send email reports on failed or partially successful sync runs and their recoveries.
              </span>
            </label>
            <Form.Item name="syncs" noStyle>
              <Switch id="syncs" />
            </Form.Item>{" "}
          </div>
          <div className="flex flex-row w-full justify-between items-center border-x border-t border-collapse p-4">
            <label htmlFor="recurringAlertsPeriodHours" className="font-main flex flex-col gap-1">
              Recurring Alerts Period (hours)
              <span className="text-xs text-textLight">
                Set the recurring alert interval in hours to limit how often email reports are sent for an ongoing
                unhealthy state.
                <br />
                <code>0</code> – means send every status.
              </span>
            </label>
            <Form.Item name="recurringAlertsPeriodHours" noStyle>
              <Input
                id="recurringAlertsPeriodHours"
                type={"number"}
                min={0}
                max={720}
                defaultValue={24}
                className="w-10"
                style={{ width: 75 }}
              />
            </Form.Item>
          </div>
        </div>
        <div className="flex flex-row w-full justify-between items-center border rounded-b-lg border-collapse p-4 bg-gray-50">
          {workspace ? (
            <div className="text-xs text-textDark">
              Email notification settings are managed separately for each workspace per user.
              <br />
              The current form controls notification settings for{" "}
              <span className={"text-black font-bold"}>{user.email}</span>, specifically for events in the{" "}
              <span className={"text-black font-bold"}>{workspace!.name || workspace!.slug}</span>
              {workspace!.name.includes("workspace") ? "" : " workspace"}.
            </div>
          ) : (
            <div className="text-xs text-textDark">
              Email notification settings are managed individually for each workspace in the workspace’s Notification
              settings.
              <br />
              This setting will be applied by default to newly created workspaces or workspaces where the user is
              invited.
            </div>
          )}
          <Button
            type={"primary"}
            size={"large"}
            onClick={async () => {
              setSaving(true);
              try {
                await get(`/api/user/notifications-settings${workspace ? `?workspaceId=${workspace.id}` : ""}`, {
                  method: "POST",
                  body: notificationPreference,
                });
                feedbackSuccess(`User Notification Settings has been saved`);
              } catch (e) {
                feedbackError(`Failed to save User Notification Settings`, { error: e });
              } finally {
                //await reload();
                setSaving(false);
              }
            }}
            disabled={saving || loading}
            loading={loading}
          >
            Save
          </Button>
        </div>
      </Form>
    </div>
  );
};

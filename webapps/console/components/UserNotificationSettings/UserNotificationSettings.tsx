import React, { useEffect, useState } from "react";
import { Button, Form, Input, Switch } from "antd";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import type { UserNotificationsPreferences } from "../../lib/server/user-preferences";
import { get, useApi } from "../../lib/useApi";
import { ErrorCard } from "../GlobalError/GlobalError";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { useUser, WorkspaceContext } from "../../lib/context";
import { eventTypeLabels } from "../../pages/[workspaceId]/settings/notifications";

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
          setNotificationPreference({ ...notificationPreference, ...newValues } as UserNotificationsPreferences);
        }}
      >
        <div className="flex flex-col mt-4 w-full">
          <div className="flex flex-row w-full justify-between items-center border rounded-t-lg p-4">
            <label htmlFor="batches" className="font-main flex flex-col gap-1">
              {eventTypeLabels["batch"].label}
              <span className="text-xs text-textLight">{eventTypeLabels["batch"].description}</span>
            </label>
            <Form.Item name="batches" noStyle>
              <Switch id="batches" />
            </Form.Item>{" "}
          </div>
          <div className="flex flex-row w-full justify-between items-center border rounded-t-lg p-4">
            <label htmlFor="dead" className="font-main flex flex-col gap-1">
              {eventTypeLabels["dead"].label}
              <span className="text-xs text-textLight">{eventTypeLabels["dead"].description}</span>
            </label>
            <Form.Item name="dead" noStyle>
              <Switch id="dead" />
            </Form.Item>{" "}
          </div>
          <div className="flex flex-row w-full justify-between items-center border-x border-t border-collapse p-4">
            <label htmlFor="syncs" className="font-main flex flex-col gap-1">
              {eventTypeLabels["sync"].label}
              <span className="text-xs text-textLight">{eventTypeLabels["sync"].description}</span>
            </label>
            <Form.Item name="syncs" noStyle>
              <Switch id="syncs" />
            </Form.Item>{" "}
          </div>
          <div className="flex flex-row w-full justify-between items-center border-x border-t border-collapse p-4">
            <label htmlFor="account" className="font-main flex flex-col gap-1">
              {eventTypeLabels["account"].label}
              <span className="text-xs text-textLight">{eventTypeLabels["account"].description}</span>
            </label>
            <Form.Item name="account" noStyle>
              <Switch id="account" />
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
                defaultValue={168}
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

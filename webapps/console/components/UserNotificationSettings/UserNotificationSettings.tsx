import React, { useEffect, useState } from "react";
import { Button, Form, Input, Switch } from "antd";
import { feedbackError, feedbackSuccess } from "../../lib/ui";
import type { UserNotificationsPreferences } from "../../lib/server/user-preferences";
import { get, useApi } from "../../lib/useApi";
import { ErrorCard } from "../GlobalError/GlobalError";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { WorkspaceContext } from "../../lib/context";

export const UserNotificationSettings: React.FC<{
  className?: string;
  workspace?: WorkspaceContext;
  title?: React.ReactNode;
}> = ({ className, title, workspace }) => {
  const {
    isLoading: loading,
    data,
    error,
  } = useApi<UserNotificationsPreferences>(
    `/api/user/notifications${workspace ? `?workspaceId=${workspace.id}&mergeWithGlobal=true` : ""}`
  );
  const [notificationPreference, setNotificationPreference] = useState<UserNotificationsPreferences | undefined>(data);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    setNotificationPreference(data);
  }, [data]);

  if (error) {
    return <ErrorCard error={error} title="Failed to load User Notification Settings" />;
  } else if (loading) {
    return <LoadingAnimation />;
  }
  return (
    <div className={`px-8 py-6 border border-textDisabled rounded-lg ${className ?? ""}`}>
      {title ? (
        title
      ) : (
        <label htmlFor="notification" className="text-lg font-bold">
          Notification Settings
        </label>
      )}
      <Form
        form={form}
        disabled={loading || saving}
        initialValues={data}
        onValuesChange={async newValues => {
          console.log("newValues", newValues);
          setNotificationPreference({ ...notificationPreference, ...newValues });
        }}
      >
        <div className="flex flex-col mt-5">
          <div className="flex items-baseline gap-3">
            <label htmlFor="batches" className="font-main w-64">
              Warehouse Batches statuses
            </label>
            <Form.Item name="batches">
              <Switch id="batches" />
            </Form.Item>{" "}
          </div>
          <div className="flex items-baseline gap-3">
            <label htmlFor="syncs" className="font-main  w-64">
              Connector Sync statuses
            </label>
            <Form.Item name="syncs">
              <Switch id="syncs" />
            </Form.Item>{" "}
          </div>
          <div className="flex items-baseline gap-3">
            <label htmlFor="batches" className="font-main w-64">
              Recurring Alerts Period (hours)
            </label>
            <Form.Item name="recurringAlertsPeriodHours">
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
        <div className="flex justify-end">
          <Button
            type={"primary"}
            size={"large"}
            onClick={async () => {
              setSaving(true);
              try {
                await get(`/api/user/notifications${workspace ? `?workspaceId=${workspace.id}` : ""}`, {
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

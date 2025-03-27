import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../../components/ConfigObjectEditor/ConfigEditor";
import { useUser, useWorkspace } from "../../../lib/context";
import React from "react";
import { NotificationChannel } from "../../../lib/schema";
import { CustomWidgetProps } from "../../../components/ConfigObjectEditor/Editors";
import { Select } from "antd";
import { BellIcon, MailIcon, Slack } from "lucide-react";
import { rpc } from "juava";
import { UserNotificationSettings } from "../../../components/UserNotificationSettings/UserNotificationSettings";
import { useRouter } from "next/router";

const Misc: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <NotificationChannelList />
    </WorkspacePageLayout>
  );
};

export const FakeEditor: React.FC<{ schema: any } & CustomWidgetProps<string[]>> = props => {
  return (
    <div className={"rounded-md border border-gray-300 bg-gray-50 text-text p-1.5 px-2.5"}>All Workspace Users</div>
  );
};

export const StringArrayEditor: React.FC<{ schema: any } & CustomWidgetProps<string[]>> = props => {
  return (
    <Select
      mode={!props.schema.items?.enum ? "tags" : "multiple"}
      allowClear
      style={{ width: "100%" }}
      value={props.value}
      showSearch={false}
      showArrow={false}
      options={props.schema.items?.enum?.map(o => ({ label: o, value: o }))}
      onChange={v => {
        props.onChange(v);
      }}
    />
  );
};

const NotificationChannelList: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const router = useRouter();
  const user = useUser();

  const config: ConfigEditorProps<NotificationChannel> = {
    listColumns: [
      {
        title: "Channel",
        render: (s: NotificationChannel) => {
          switch (s.channel) {
            case "slack":
              return (
                <div className={"flex flex-row gap-1.5 items-center"}>
                  <Slack className={"w-4 h-4"} /> {s.channel}
                </div>
              );
            case "email":
              return (
                <div className={"flex flex-row gap-1.5 items-center"}>
                  <MailIcon className={"w-4 h-4"} /> {s.channel}
                </div>
              );
            default:
              return <span>{s.channel}</span>;
          }
        },
      },
    ],
    pathPrefix: "/settings",
    objectType: NotificationChannel,
    fields: {
      type: { constant: "notification" },
      workspaceId: { constant: workspace.id },
      events: {
        editor: StringArrayEditor,
      },
      channel: {
        constant: "slack",
      },
      slackWebhookUrl: {
        hidden: a => a.channel !== "slack",
        documentation: (
          <>
            See the slack documentation on how to{" "}
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">
              create a webhook URL
            </a>
          </>
        ),
      },
      // allWorkspaceEmails: {
      //   hidden: a => a.channel !== "email",
      // },
      emails: {
        displayName: "Recipients",
        editor: FakeEditor,
        hidden: a => a.channel !== "email",
        documentation: <>Email notifications are sent to all workspace users.</>,
      },
      recurringAlertsPeriodHours: {
        displayName: "Recurring Alerts Period (hours)",
        documentation: (
          <>
            How often to send recurring alerts in hours. <code>0</code> means send every status.
          </>
        ),
      },
    },
    noun: "Slack Notification Channel",
    type: "notification",
    listTitle: "Slack Notifications",
    explanation: "Notification Channel settings",
    testConnectionEnabled: obj => (obj.channel === "slack" && !!obj.slackWebhookUrl ? "manual" : false),
    testButtonLabel: "Send test notification",
    onTest: async obj => {
      try {
        return await rpc(`/api/${workspace.id}/notification-test`, {
          body: obj,
        });
      } catch (error: any) {
        return { ok: false, error: `Cannot perform check` };
      }
    },
    icon: () => <BellIcon className="w-full h-full" />,
    editorTitle: (_: NotificationChannel, isNew: boolean) => {
      const verb = isNew ? "New" : "Edit";
      return (
        <div className="flex items-center">
          <div className="h-12 w-12 mr-4">
            <BellIcon className="w-full h-full" />
          </div>
          {verb} Slack Notification channel
        </div>
      );
    },
  };
  return (
    <>
      <ConfigEditor {...(config as any)} />
      {!router.query.id && (
        <>
          <h1 className={"text-3xl mt-12"}>My Email Notifications</h1>
          <UserNotificationSettings className={"mt-6"} workspace={workspace} />
        </>
      )}
    </>
  );
};

export default Misc;

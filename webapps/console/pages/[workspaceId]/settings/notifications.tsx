import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../../components/ConfigObjectEditor/ConfigEditor";
import { useWorkspace } from "../../../lib/context";
import React from "react";
import { NotificationChannel } from "../../../lib/schema";
import { CustomWidgetProps } from "../../../components/ConfigObjectEditor/Editors";
import { Select } from "antd";
import { BellIcon } from "lucide-react";

const Misc: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <NotificationChannelList />
    </WorkspacePageLayout>
  );
};

export const StringArrayEditor: React.FC<{ schema: any } & CustomWidgetProps<string[]>> = props => {
  console.log("StringArray", props);
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

  const config: ConfigEditorProps<NotificationChannel> = {
    listColumns: [
      {
        title: "Channel",
        render: (s: NotificationChannel) => <span className={"font-semibold"}>{`${s.channel}`}</span>,
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
      slackWebhookUrl: {
        hidden: a => a.channel !== "slack",
      },
      // allWorkspaceEmails: {
      //   hidden: a => a.channel !== "email",
      // },
      // emails: {
      //   editor: StringArrayEditor,
      //   hidden: a => a.channel !== "email" || a.allWorkspaceEmails,
      // },
      recurringAlertsPeriodHours: {
        displayName: "Recurring Alerts Period (hours)",
        documentation: (
          <>
            How often to send recurring alerts in hours. <code>0</code> means send every status.
          </>
        ),
      },
    },
    noun: "Notification Channel",
    type: "notification",
    explanation: "Notification Channel settings",
    icon: () => <BellIcon className="w-full h-full" />,
    editorTitle: (_: NotificationChannel, isNew: boolean) => {
      const verb = isNew ? "New" : "Edit";
      return (
        <div className="flex items-center">
          <div className="h-12 w-12 mr-4">
            <BellIcon className="w-full h-full" />
          </div>
          {verb} notification channel
        </div>
      );
    },
  };
  return (
    <>
      <ConfigEditor {...(config as any)} />
    </>
  );
};

export default Misc;

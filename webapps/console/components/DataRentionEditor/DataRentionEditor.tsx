import { Alert, Button, Form, Input, Skeleton, Switch } from "antd";
import { useWorkspace } from "../../lib/context";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../lib/useApi";
import { ErrorCard } from "../GlobalError/GlobalError";
import { ReactNode, useState } from "react";
import { DataRetentionSettings } from "../../lib/shared/data-retention";
import { getLog, rpc } from "juava";
import Link from "next/link";
import merge from "lodash/merge";
import { z } from "zod";
import { useBilling } from "../Billing/BillingProvider";
import { CheckOutlined } from "@ant-design/icons";
import { feedbackError, feedbackSuccess } from "../../lib/ui";

export const ConfigSection: React.FC<{ title: string; documentation: ReactNode; children: ReactNode }> = ({
  title,
  documentation,
  children,
}) => {
  return (
    <div className="border-textDisabled border px-12 py-6 rounded-lg">
      <h2 className="text-2xl mb-4 font-bold">{title}</h2>
      <div className="text-textLight mb-4">{documentation}</div>
      <div>{children}</div>
    </div>
  );
};

export const DataRetentionEditorLoader: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const dataRetention = useQuery(
    ["data-retention", workspace.id],
    () => get(`/api/workspace/${workspace.id}/data-retention`),
    { retry: false, cacheTime: 0, refetchOnWindowFocus: false }
  );
  const billing = useBilling();
  return (
    <div>
      {(dataRetention.isLoading || billing.loading) && <Skeleton active={true} />}
      {dataRetention.isError && <ErrorCard error={dataRetention.error} />}
      {dataRetention.data && (
        <DataRetentionEditor
          readonly={!billing.settings?.dataRetentionEditorEnabled}
          pendingUpdate={!!dataRetention.data.pendingUpdate}
          obj={dataRetention.data}
        />
      )}
    </div>
  );
};

export const UnitEditor: React.FC<{ name: any; unit: string }> = ({ name, unit }) => {
  const form = Form.useFormInstance();
  return (
    <div className="flex gap-2 items-center">
      <Form.Item name={name} noStyle>
        <Input className="mr-12 max-w-[12em]" />
      </Form.Item>
      <span>
        {unit}
        {unit === "hours" && form.getFieldValue(name)
          ? `, equal to ${parseFloat((parseInt(form.getFieldValue(name)) / 24).toFixed(2))} days`
          : ``}
      </span>
    </div>
  );
};

export const FormValuesType = DataRetentionSettings.omit({ disableS3Archive: true }).and(
  z.object({
    mongoEnabled: z.coerce.boolean(),
    enableS3Archive: z.coerce.boolean(),
  })
);

type FormValuesType = z.infer<typeof FormValuesType>;

function fromFormValues({ mongoEnabled, enableS3Archive, ...values }: FormValuesType): DataRetentionSettings {
  return DataRetentionSettings.parse({
    ...values,
    disableS3Archive: !enableS3Archive,
    customMongoDb: mongoEnabled ? values.customMongoDb : undefined,
  });
}

function toFormValues(obj: DataRetentionSettings): FormValuesType {
  return {
    ...obj,
    mongoEnabled: !!obj.customMongoDb,
    enableS3Archive: !obj.disableS3Archive,
  };
}

export const DataRetentionEditor: React.FC<{
  obj: DataRetentionSettings;
  readonly?: boolean;
  pendingUpdate: boolean;
}> = ({ obj, readonly, pendingUpdate }) => {
  const [form] = Form.useForm();
  const initialFormValues = toFormValues(obj);
  const workspace = useWorkspace();
  const [pendingUpdateState, setPendingUpdateState] = useState<boolean>(pendingUpdate);
  const [saving, setSaving] = useState(false);
  const [currentObj, setCurrentObj] = useState<FormValuesType>(initialFormValues);
  return (
    <>
      {readonly && (
        <div className="pb-4">
          <Alert
            message="Data Retention Editor is disabled for your account"
            description={
              <>
                Your subscription doesn't allow to change data retention settigns. However, you view Jitsu default
                setting to understand how your data is being stored. Contact support@jitsu.com if you have any questions
                regarding data retention policy.{" "}
              </>
            }
            type="info"
            showIcon
          />
        </div>
      )}
      {pendingUpdateState && (
        <div className="pb-4">
          <Alert
            message="Retention Policy update is pending"
            description={
              <>
                You have requested to change retention policy earlier. Allow use a few days to apply the changes. Please
                contact <Link href={"/support"}>support</Link> if you have any questions
              </>
            }
            type="info"
            showIcon
          />
        </div>
      )}
      <Form
        form={form}
        disabled={readonly || saving || pendingUpdateState}
        initialValues={initialFormValues}
        onValuesChange={newValues => {
          const merged = FormValuesType.parse(merge(currentObj, newValues));
          setCurrentObj(merged);
          getLog().atDebug().log("Settings", merged);
        }}
      >
        <div className="flex flex-col gap-4">
          <ConfigSection
            title="Queues Retention"
            documentation={
              <>
                How many hours to keep data in queues. If destnation is down, Jitsu will try to deliver data during
                timeframe configured below. After the time is passed, Jitsu will drop events
              </>
            }
          >
            <UnitEditor name="kafkaRetentionHours" unit="hours" />
          </ConfigSection>
          <ConfigSection
            title="Identity Stiching Retention"
            documentation={
              <>
                How many days to keep user events to implement{" "}
                <Link href="https://docs.jitsu.com/features/identity-stitching">identity stitching</Link>. After the
                time is passed, Jitsu will drop data. <code>0</code> will disable identity stitching.
              </>
            }
          >
            <UnitEditor name="identityStitchingRetentionDays" unit="days" />
          </ConfigSection>
          <ConfigSection
            title="Logs Retention"
            documentation={
              <>
                Live Events and function logs retention policy. OR logic is applied. The events will be dropped if they
                stored in the logs more than X days, or the logs size is more than N records
              </>
            }
          >
            <div className="mb-4">
              <UnitEditor name={["logsRetentionDays", "maxHours"]} unit="hours" />
            </div>

            <UnitEditor name={["logsRetentionDays", "maxRecords"]} unit="records" />
          </ConfigSection>
          <ConfigSection
            title="Enable Custom Mongo DB"
            documentation={
              <>
                Jitsu users Mongo DB as underneath mechanism for{" "}
                <Link href="https://docs.jitsu.com/functions/runtime#persistent-storage">
                  functions persistent storage
                </Link>{" "}
                and <Link href="https://docs.jitsu.com/features/identity-stitching">identity stitching</Link>. You can
                use your own Mongo instance to store this data.
              </>
            }
          >
            <div className="flex items-center gap-2">
              <Form.Item name="mongoEnabled" noStyle>
                <Switch id="mongoEnable" />
              </Form.Item>{" "}
              <label htmlFor="mongoEnable">{currentObj.mongoEnabled ? "Enabled" : "Disabled"}</label>
            </div>
            <div className="mt-4">
              <Form.Item className="customMongoDb" noStyle>
                <Input className="mb-4" placeholder="Mongo DB connection string" disabled={!currentObj.mongoEnabled} />
              </Form.Item>
            </div>
          </ConfigSection>
          <ConfigSection
            title="S3 Archive"
            documentation={
              <>
                Jitsu archives all incoming event into a dedicated S3 bucket{" "}
                <code>{workspace.id}.data.use.jitsu.com</code> so they could be replayed later. You can disable this
                behavior if you don't need it.
              </>
            }
          >
            <div className="flex items-center gap-2">
              <Form.Item name="enableS3Archive" noStyle valuePropName="checked">
                <Switch id="enableS3Archive" />
              </Form.Item>
              <label htmlFor="enableS3Archive">{currentObj.enableS3Archive ? "Enabled" : "Disabled"}</label>
            </div>
          </ConfigSection>
        </div>
        <div className="flex justify-end mt-4">
          <Button
            type={"primary"}
            size="large"
            onClick={async () => {
              setSaving(true);
              try {
                await rpc(`/api/workspace/${workspace.id}/data-retention`, {
                  body: { ...fromFormValues(currentObj), pendingUpdate: true },
                });
                setPendingUpdateState(true);
                feedbackSuccess("Data retention settings saved");
              } catch (e: any) {
                feedbackError("Failed to save data retention settings", { error: e });
              } finally {
                setSaving(false);
              }
            }}
            disabled={readonly || saving || pendingUpdateState}
            loading={saving}
            icon={<CheckOutlined />}
          >
            Save
          </Button>
        </div>
      </Form>
    </>
  );
};

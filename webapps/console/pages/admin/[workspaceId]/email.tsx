import { Form, Select, Button, Modal, notification, Input } from "antd";
import { useWorkspace } from "../../../lib/context";
import Link from "next/link";
import { useState } from "react";
import { requireDefined } from "juava";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { CodeBlock } from "../../../components/CodeBlock/CodeBlock";
import { GetServerSideProps, NextApiRequest, NextApiResponse } from "next";
import { getUser, verifyAdmin } from "../../../lib/api";
import { db } from "../../../lib/server/db";

const EmailHistoryLoader = ({ workspaceId }) => {
  const loader = useQuery({
    queryKey: ["email-history", workspaceId],
    queryFn: async () => {
      const result = await fetch(`/api/${workspaceId}/ee/email-history`);
      if (!result.ok) {
        throw new Error(`Failed to load email history`);
      }
      return await result.json();
    },
  });
  if (loader.isLoading) {
    return (
      <div className="flex items-center justify-center w-full min-h-96">
        <Loader2 className="animate-spin" />
      </div>
    );
  } else if (loader.error) {
    throw loader.error;
  } else {
    return <CodeBlock>{JSON.stringify(loader.data, null, 2)}</CodeBlock>;
  }
};

function SetThrottle({ throttle }: { throttle?: number }) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const workspace = useWorkspace();

  const onFinish = async values => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/${workspace.id}/ee/set-throttle?throttle=${values.throttle}&workspace=${workspace.id}`
      );
      if (!res.ok) {
        throw new Error(`Failed to send email: ${res.statusText}`);
      }
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
      setModalVisible(true);
    } catch (error: any) {
      notification.error({ message: "Failed to send email", description: error?.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Form layout="horizontal" onFinish={onFinish}>
        <Form.Item
          label="Throttle Percent"
          name="throttle"
          rules={[{ required: true, message: "Please set throttle" }]}
        >
          <Input placeholder="Set a new throttle" defaultValue={throttle} />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            Set throttle
          </Button>
        </Form.Item>
      </Form>

      <Modal title="Response JSON" open={modalVisible} onCancel={() => setModalVisible(false)} footer={null}>
        <CodeBlock>{response}</CodeBlock>
      </Modal>
    </>
  );
}

function SendEmailForm() {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const workspace = useWorkspace();

  const onFinish = async values => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${workspace.id}/ee/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: values.template,
          workspaceId: workspace.id,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to send email: ${res.statusText}`);
      }
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
      setModalVisible(true);
    } catch (error: any) {
      notification.error({ message: "Failed to send email", description: error?.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Form layout="horizontal" onFinish={onFinish}>
        <Form.Item label="Template" name="template" rules={[{ required: true, message: "Please select a template" }]}>
          <Select placeholder="Select a template">
            {[
              "welcome",
              "churned",
              "quota-exceeded",
              "quota-about-to-exceed",
              "billing-issues",
              "throttling-reminder",
              "throttling-started",
              "connection-status-failed",
              "connection-status-success",
            ].map(option => (
              <Select.Option key={option} value={option}>
                {option}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            Send email
          </Button>
        </Form.Item>
      </Form>

      <Modal title="Response JSON" open={modalVisible} onCancel={() => setModalVisible(false)} footer={null}>
        <CodeBlock>{response}</CodeBlock>
      </Modal>
    </>
  );
}

export default function EmailHistoryPage(props) {
  const workspace = useWorkspace();
  return (
    <div className="p-12 mx-auto max-w-5xl">
      <div className="flex gap-2 items-center justify-center" key={"menu"}>
        <Button href="/">Home</Button>
        <Button href="/admin/workspaces">Admin workspaces</Button>
        <Button href="/admin/overage-billing">Overage billing</Button>
      </div>
      <div key={"header"}>
        <h1 className="text-2xl text-center my-12">
          Workspace{" "}
          <Link className={"underline"} href={`/${workspace.slugOrId}`}>
            {workspace.name}
          </Link>{" "}
          email
        </h1>
      </div>
      <EmailHistoryLoader workspaceId={workspace.id} />
      <div className="border rounded shadow px-6 py-6 my-12" key={"send-email"}>
        <SendEmailForm />
      </div>
      <div className="border rounded shadow px-6 py-6 my-12" key={"send-email"}>
        <SetThrottle throttle={props.throttle as number} />
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async context => {
  const user = requireDefined(
    await getUser(context.res as NextApiResponse, context.req as NextApiRequest, true),
    `Authentication required`
  );
  await verifyAdmin(user);
  const workspaceIdOrSlug = requireDefined(context.query.workspaceId, `workspaceId id is required`) as string;
  const workspace = requireDefined(
    await db.prisma().workspace.findFirst({
      where: {
        OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }],
      },
    }),
    `Workspace not found: ${workspaceIdOrSlug}`
  );

  const throttleFeature = workspace.featuresEnabled.find(f => f.startsWith("throttle"));

  return {
    props: {
      throttle: throttleFeature ? parseInt(throttleFeature.replace("throttle", "").replace("=", "")) : 0,
    },
  };
};

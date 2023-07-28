import { get, useApi } from "../../lib/useApi";
import { Loader2, UserCheck } from "lucide-react";
import { ErrorCard, ErrorDetails } from "../../components/GlobalError/GlobalError";
import { Input, Table } from "antd";
import { CodeBlock } from "../../components/CodeBlock/CodeBlock";
import { FaArrowLeft } from "react-icons/fa";
import { useRouter } from "next/router";
import { urlWithQueryString } from "juava";
import { useState } from "react";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { feedbackError } from "../../lib/ui";
import { useFirebaseSession } from "../../lib/firebase-client";
import { JitsuButton } from "../../components/JitsuButton/JitsuButton";

export const UserDetails: React.FC<{ externalId?: string; internalId?: string }> = props => {
  const { data, isLoading, error } = useApi(urlWithQueryString(`/api/admin/users`, props, { filterUndefined: true }));
  if (isLoading) {
    return (
      <div className="flex justify-center items-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  } else if (error) {
    return (
      <div className="flex justify-center items-center">
        <ErrorDetails error={error} />
      </div>
    );
  } else {
    return <CodeBlock lang="json">{JSON.stringify(data.users[0], null, 2)}</CodeBlock>;
  }
};

export const BecomeUser: React.FC<{ externalId?: string; internalId?: string }> = props => {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const fb = useFirebaseSession();
  return (
    <JitsuButton
      disabled={loading}
      icon={loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
      onClick={async () => {
        setLoading(true);
        try {
          const { token } = await get(`/api/admin/become`, { method: "POST", body: { externalId: props.externalId } });
          await fb.resolveUser(token).user;
          //we need to a full reload, so the top level components catch up on the new user
          window.location.assign("/");
        } catch (e) {
          feedbackError("Failed to become user", { error: e });
        } finally {
          setLoading(false);
        }
      }}
    >
      Become
    </JitsuButton>
  );
};

export const UsersAdminPage = () => {
  const { data, isLoading, error } = useApi(`/api/admin/users`);
  const router = useRouter();
  const [filter, setFilter] = useQueryStringState("filter");
  if (isLoading) {
    return (
      <div className="w-screen h-screen flex justify-center items-center">
        <Loader2 className="h-16 w-16 animate-spin" />
      </div>
    );
  } else if (error) {
    return (
      <div className="w-screen h-screen flex justify-center items-center">
        <ErrorCard error={error} />
      </div>
    );
  }
  const columns = [
    {
      title: "External ID",
      sorter: (a, b) => (a.externalId || "").localeCompare(b.externalId || ""),
      render: user => user.externalId,
    },
    {
      title: "Internal ID",
      sorter: (a, b) => (a.internalId || "").localeCompare(b.internalId || ""),
      render: user => user.internalId || "",
    },
    {
      title: "Email",
      sorter: (a, b) => (a.email || "").localeCompare(b.externalId),
      render: user => user.email || "",
    },
    {
      title: "Name",
      sorter: (a, b) => (a.externalId || "").localeCompare(b.externalId || ""),
      render: user => user.name || "",
    },
    {
      title: "",
      render: user => <BecomeUser internalId={user.internalId} externalId={user.externalId} />,
    },
  ];
  const dataSource = data.users
    .filter(u => !filter || JSON.stringify(u).indexOf(filter) >= 0)
    .map(user => ({ ...user, key: user.externalId || user.internalId }));
  return (
    <div className="p-12">
      <div className="flex justify-between mb-12">
        <div className="flex items-center">
          <Input.Search
            allowClear
            defaultValue={filter || undefined}
            placeholder="Search users"
            onSearch={val => setFilter(val)}
          />
          <div className="whitespace-nowrap ml-3">
            Total: <b>{new Intl.NumberFormat("en-US").format(data.users.length)}</b> users
          </div>
        </div>
        <JitsuButton icon={<FaArrowLeft />} size="large" type="primary" onClick={() => router.back()}>
          Go back
        </JitsuButton>
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={{ pageSize: 100 }}
        expandable={{
          expandedRowRender: user => (
            <UserDetails key={user.internalId} internalId={user.internalId} externalId={user.externalId} />
          ),
        }}
      />
    </div>
  );
};

export default UsersAdminPage;

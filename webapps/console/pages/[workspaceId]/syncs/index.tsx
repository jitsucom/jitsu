import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import { get } from "../../../lib/useApi";
import { DestinationConfig, ServiceConfig } from "../../../lib/schema";
import { ConfigurationObjectLinkDbModel } from "../../../prisma/schema";
import { QueryResponse } from "../../../components/QueryResponse/QueryResponse";
import { z } from "zod";
import { Table, Tooltip } from "antd";
import { confirmOp, feedbackError, feedbackSuccess } from "../../../lib/ui";
import React, { useState } from "react";
import Link from "next/link";
import { FaExternalLinkAlt, FaPlus, FaRunning, FaTrash } from "react-icons/fa";
import { index, rpc } from "juava";
import { getCoreDestinationType } from "../../../lib/schema/destinations";
import { useRouter } from "next/router";
import { FiEdit2 } from "react-icons/fi";
import { useLinksQuery } from "../../../lib/queries";
import { jsonSerializationBase64, useQueryStringState } from "../../../lib/useQueryStringState";
import { TableProps } from "antd/es/table/InternalTable";
import { ColumnType, SortOrder } from "antd/es/table/interface";
import { Inbox } from "lucide-react";
import { PlusOutlined } from "@ant-design/icons";
import { JitsuButton, WJitsuButton } from "../../../components/JitsuButton/JitsuButton";

function EmptyLinks() {
  const workspace = useWorkspace();
  return (
    <div>
      <div className="flex flex-col items-center">
        <div className="text-xl text-textLight mb-3">
          {" "}
          You don't have any links between <Link href={`/${workspace.id}/services`}>services</Link> and{" "}
          <Link href={`/${workspace.id}/destinations`}>destinations</Link>
        </div>

        <WJitsuButton href={`/syncs/edit`} type="link">
          <span className="text-lg">Create your first sync</span>
        </WJitsuButton>
      </div>
    </div>
  );
}

type SyncDbModel = z.infer<typeof ConfigurationObjectLinkDbModel>;

type RemoteEntitiesProps = {
  services: ServiceConfig[];
  destinations: DestinationConfig[];
  links: Omit<SyncDbModel, "data">[];
  reloadCallback: () => void;
};

type SortingSettings = {
  columns: { order: SortOrder; field: string }[];
};

function SyncsTable({ links, services, destinations, reloadCallback }: RemoteEntitiesProps) {
  const servicesById = index(services, "id");
  const destinationsById = index(destinations, "id");
  const workspace = useWorkspace();
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [sorting, setSorting] = useQueryStringState<SortingSettings>("sorting", {
    defaultValue: { columns: [] },
    ...jsonSerializationBase64,
  });
  const deleteSync = async (link: Omit<SyncDbModel, "data">) => {
    if (await confirmOp("Are you sure you want to unlink this service from this destination?")) {
      setLoading(true);
      try {
        await get(`/api/${workspace.id}/config/link`, {
          method: "DELETE",
          query: { fromId: link.fromId, toId: link.toId },
        });
        feedbackSuccess("Successfully unliked");
        reloadCallback();
      } catch (e) {
        feedbackError("Failed to unlink service and destination", { error: e });
      } finally {
        setLoading(false);
      }
    }
  };
  const onChange: TableProps<any>["onChange"] = (pagination, filters, sorter, { currentDataSource }) => {
    const sortArray = Array.isArray(sorter) ? sorter : [sorter];
    const columns = sortArray
      .filter(s => !!s.column?.title && !!s.order)
      .map(s => ({ field: s.column?.title, order: s.order }));
    const newVal = {
      columns: columns as any,
    };
    setSorting(newVal);
    console.log("sorter", newVal);
  };
  const columns: ColumnType<any>[] = [
    {
      title: "Service",
      width: "60%",
      sortOrder: sorting.columns?.find(s => s.field === "Service")?.order,
      sorter: (a, b) => {
        const serviceA = servicesById[a.fromId];
        const serviceB = servicesById[b.fromId];
        return (serviceA.name || "").localeCompare(serviceB.name || "");
      },
      render: (text, link) => {
        const service = servicesById[link.fromId];
        if (!service) {
          return <div>Service not found</div>;
        }
        return (
          <div className="flex items-center">
            <div className="h-8 w-8">
              <Tooltip title={service.package}>
                <img
                  alt={service.package}
                  src={`/api/sources/logo?type=${service.protocol}&package=${encodeURIComponent(service.package)}`}
                />
              </Tooltip>
            </div>
            <div>{service.name}</div>
            <div>
              <WJitsuButton
                href={`/services?id=${link.fromId}`}
                type="link"
                className="link"
                size="small"
                icon={<FaExternalLinkAlt className="w-3 h-3" />}
              />
            </div>
          </div>
        );
      },
    },
    {
      title: "Destination",
      width: "40%",
      sortOrder: sorting.columns?.find(s => s.field === "Destination")?.order,

      sorter: (a, b) => {
        const destA = destinationsById[a.toId];
        const destB = destinationsById[b.toId];
        return (destA.name || "").localeCompare(destB.name || "");
      },
      render: (text, link) => {
        const destination = destinationsById[link.toId];
        if (!destination) {
          return <div>Destination not found</div>;
        }
        const coreDestinationType = getCoreDestinationType(destination.destinationType);
        return (
          <div>
            <div className="flex items-center">
              <div className="h-8 w-8">
                <Tooltip title={coreDestinationType.title}>{coreDestinationType.icon}</Tooltip>
              </div>
              <div className="ml-2">{destination.name}</div>
              <div>
                <JitsuButton
                  type="link"
                  icon={<FaExternalLinkAlt className="w-3 h-3" />}
                  className="link"
                  size="small"
                  href={`/${workspace.id}/destinations?id=${link.toId}`}
                />
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: "Actions",
      render: (text, link) => (
        <div className="flex justify-end items-center">
          <JitsuButton
            type="text"
            size="large"
            icon={<FaRunning />}
            onClick={async () => {
              rpc(`/api/${workspace.id}/sources/run?syncId=${link.id}`);
            }}
          />
          <WJitsuButton href={`/syncs/edit?id=${link.id}`} type="text" size="large" icon={<FiEdit2 />} />
          <JitsuButton
            type="text"
            size="large"
            icon={<FaTrash />}
            onClick={() => {
              deleteSync(link);
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <div>
      <Table
        rowKey={"id"}
        dataSource={links}
        sortDirections={["ascend", "descend"]}
        columns={columns}
        className="border border-backgroundDark rounded-lg"
        pagination={false}
        loading={loading}
        onChange={onChange}
      />
    </div>
  );
}

function Syncs(props: RemoteEntitiesProps) {
  const { services, destinations, links } = props;
  const workspace = useWorkspace();
  if (props.services.length == 0 || props.destinations.length == 0) {
    return (
      <div className="flex flex-col justify-center items-center ">
        <Inbox className="w-16 h-16 text-textDisabled" />
        <div className="text-center mt-12 text text-textLight max-w-4xl">
          In order to connect service to destination please create at least one destination and one service. Currently,
          you have{" "}
          <Link href={`/${workspace.slug || workspace.id}/destinations`} className="underline">
            {props.destinations.length} destination{props.destinations.length === 1 ? "" : "s"}
          </Link>{" "}
          and{" "}
          <Link href={`/${workspace.slug || workspace.id}/services`} className="underline">
            {props.services.length} service{props.services.length === 1 ? "" : "s"}
          </Link>{" "}
          configured
        </div>
        <div className="flex space-x-4 items-center mt-4">
          <WJitsuButton href={"/destinations"} type="default" icon={<PlusOutlined />}>
            Create Destination
          </WJitsuButton>
          <WJitsuButton href={"/services"} type="default" icon={<PlusOutlined />}>
            Create Service
          </WJitsuButton>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex justify-between py-6">
        <div className="flex items-center">
          <div className="text-3xl">Edit syncs</div>
        </div>
        <div>
          <WJitsuButton href={`/syncs/edit`} type="primary" size="large" icon={<FaPlus className="anticon" />}>
            Connect service and destination
          </WJitsuButton>
        </div>
      </div>
      <div>
        {links.length === 0 && <EmptyLinks />}
        {links.length > 0 && (
          <SyncsTable
            links={links}
            services={services}
            destinations={destinations}
            reloadCallback={props.reloadCallback}
          />
        )}
      </div>
    </div>
  );
}

function SyncsLoader(props: { reloadCallback: () => void }) {
  const workspace = useWorkspace();
  const data = useLinksQuery(workspace.id, "sync", {
    cacheTime: 0,
    retry: false,
  });

  return (
    <QueryResponse
      result={data}
      render={([services, destinations, links]) => (
        <Syncs services={services} destinations={destinations} links={links} reloadCallback={props.reloadCallback} />
      )}
    />
  );
}

const SyncsPage = () => {
  const [refresh, setRefresh] = useState(new Date());
  return (
    <WorkspacePageLayout>
      <SyncsLoader
        key={refresh.toISOString()}
        reloadCallback={() => {
          setRefresh(new Date());
        }}
      />
    </WorkspacePageLayout>
  );
};
export default SyncsPage;

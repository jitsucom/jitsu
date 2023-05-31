import { ColumnsType } from "antd/es/table";
import React, { useState } from "react";
import { Button, Drawer, Table } from "antd";

type TableWithDrawerProps<EventType> = {
  loading: boolean;
  columns: ColumnsType<EventType>;
  events?: EventType[];
  loadEvents: () => void;
  drawerNode: React.FC<{ event: EventType }>;
  className?: string;
};

export const TableWithDrawer = <T extends object>({
  loadEvents,
  loading,
  columns,
  events,
  drawerNode: DrawerNode,
  className,
}: TableWithDrawerProps<T>) => {
  const [selectedEvent, setSelectedEvent] = useState<any>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const showDrawer = () => {
    setDrawerOpen(true);
  };

  const onDrawerClose = () => {
    setDrawerOpen(false);
  };
  return (
    <>
      <Table
        loading={loading}
        size={"small"}
        pagination={{ position: [], defaultPageSize: Number.MAX_SAFE_INTEGER }}
        rowKey={"id"}
        rootClassName={`cursor-pointer ${className}`}
        columns={columns}
        dataSource={events}
        onRow={(record, rowIndex) => {
          return {
            onClick: event => {
              setSelectedEvent(record);
              showDrawer();
            }, // click row
          };
        }}
        footer={
          events && events.length > 0
            ? () => (
                <div className={"flex flex-row justify-center"}>
                  <div id={"lmore"}>
                    <Button type={"primary"} ghost loading={loading} onClick={loadEvents}>
                      Load previous events
                    </Button>
                  </div>
                </div>
              )
            : undefined
        }
      />
      <Drawer
        title="Event details"
        placement="right"
        width={window.innerWidth > 2000 ? "50%" : "66%"}
        closable={true}
        onClose={onDrawerClose}
        open={drawerOpen}
      >
        {selectedEvent && <DrawerNode event={selectedEvent} />}
      </Drawer>
    </>
  );
};

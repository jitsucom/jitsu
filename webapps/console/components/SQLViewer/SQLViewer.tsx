import { Alert, Button, Empty, Layout, Table, Tooltip, Tree } from "antd";
import { rpc } from "juava";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../lib/context";
import { SQLResultType } from "../../pages/api/[workspaceId]/sql/query";
import { SQLSchemaType } from "../../pages/api/[workspaceId]/sql/schema";
import { BorderOutlined, LeftOutlined, RightOutlined, TableOutlined } from "@ant-design/icons";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { trimMiddle } from "../../lib/shared/strings";
import { LabelEllipsis } from "../LabelEllipsis/LabelEllipsis";
import { SortOrder } from "antd/es/table/interface";
import { ExpandableButton } from "../ExpandableButton/ExpandableButton";
import { FolderTree, Play } from "lucide-react";
import styles from "./SQLViewer.module.css";

import { CodeEditor } from "../CodeEditor/CodeEditor";
import ClickhouseIcon from "../../lib/schema/icons/clickhouse";

const { Sider, Content } = Layout;

type SQLViewerProps = {
  destinationId: string;
};

type SchemaTreeProps = {
  destinationId: string;
  onColumnSelect?: (column: string) => void;
  onTableSelect?: (table: string) => void;
};

const SchemaTree: React.FC<SchemaTreeProps> = ({ onColumnSelect, onTableSelect, destinationId }) => {
  const workspace = useWorkspace();
  const [schema, setSchema] = useState<SQLSchemaType>({});
  const [error, setError] = useState<any>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await rpc(`/api/${workspace.id}/sql/schema`, {
          method: "GET",
          query: { workspaceId: workspace.id, destinationId },
        });
        setSchema(res);
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [workspace.id, destinationId]);

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col justify-center items-center">
        <LoadingAnimation hideTitle={true} className="text-primaryLight" />
      </div>
    );
  }
  const schemaEntries = Object.entries(schema);
  if (error) {
    return (
      <div className="px-2 py-2 rounded-md border border-neutral-100 shadow-sm h-full">
        <Alert message={`${error}`} type="error" />
      </div>
    );
  } else if (schemaEntries.length === 0) {
    return (
      <div className="px-2 py-2 rounded-md border border-neutral-100 shadow-sm h-full">
        <h3 className="font-semibold text-lg">No tables</h3>
        <div className="text-sm text-textLight mt-6">
          The tables are created in few mins after you send your first events to Jitsu, after the first batch of events
          is processed
        </div>
      </div>
    );
  }
  const treeData = Object.entries(schema).map(([name, value]) => {
    return {
      title: <Tooltip title={name}>{trimMiddle(name, 28)}</Tooltip>,
      key: name,
      icon: <TableOutlined />,
      showIcon: false,
      selectable: true,
      children: value.map(column => {
        return {
          icon: <BorderOutlined />,
          selectable: true,
          isLeaf: true,
          checkable: false,
          title: <Tooltip title={column.name + ": " + column.type}>{trimMiddle(column.name, 28)}</Tooltip>,
          key: `${name}_${column.name}`,
        };
      }),
    };
  });

  return (
    <div
      className={`${styles.tableTree} px-2 py-2 rounded-md border border-neutral-100 shadow-sm h-full flex flex-col`}
    >
      <h3 className="font-semibold font-lg my-1">Available tables</h3>
      <Tree.DirectoryTree
        onSelect={(keys, e) => {
          if (e.node.isLeaf) {
            onColumnSelect?.(e.node.key);
          }
        }}
        selectable={false}
        showLine={true}
        className={"overflow-y-auto bg-transparent flex-auto"}
        blockNode={true}
        //showLine={true}
        showIcon={true}
        // onSelect={onSelect}
        treeData={treeData}
      />
    </div>
  );
};

export const SQLQueryDefaultLimit = 50;

const SQLViewer: React.FC<SQLViewerProps> = ({ destinationId }) => {
  const workspace = useWorkspace();
  const [cursorPosition, setCursorPosition] = useState(0);
  const [sql, setSql] = useState("SELECT * FROM events");
  const [lastQuery, setLastQuery] = useState<{ sql: string; offset: number; limit: number } | undefined>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(undefined);

  const [showSider, setShowSider] = useState(true);
  const [results, setResults] = useState<SQLResultType>({
    meta: [],
    data: [],
    rows: 0,
    statistics: {},
    offset: 0,
    limit: SQLQueryDefaultLimit,
  });

  const runQuery = useCallback(
    async (sql: string, offset?: number, limit: number = SQLQueryDefaultLimit) => {
      setLoading(true);
      setError("");
      try {
        const res = await rpc(`/api/${workspace.id}/sql/query`, {
          method: "POST",
          query: { destinationId },
          body: { query: sql, offset: offset, limit: limit },
        });
        setResults(res);
        setLastQuery({ sql, offset: res.offset, limit: res.limit });
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    },
    [workspace.id, destinationId]
  );

  // runNewQuery resets pagination offset. Used only for Ctrl+Enter + Button click
  const runNewQuery = useCallback(
    async (sql: string, limit: number = SQLQueryDefaultLimit) => {
      await runQuery(sql, undefined, limit);
    },
    [runQuery]
  );

  const sorter = (a: any, b: any, type: string) => {
    const t = type.toLowerCase();
    const isNumber = t.includes("int") || t.includes("float") || t.includes("numeric") || t.includes("decimal");
    const convert = (v: any) => {
      try {
        return isNumber ? parseFloat(v) : v;
      } catch (e) {
        return v;
      }
    };
    const av = convert(a),
      bv = convert(b);
    if (av > bv) return 1;
    if (av < bv) return -1;
    return 0;
  };

  const columns = useMemo(() => {
    return results.meta.map(m => ({
      title: <Tooltip title={m.name + ": " + m.type}>{m.name}</Tooltip>,
      dataIndex: m.name,
      fixed: m.name === "#",
      sortDirections: ["descend", "ascend"] as SortOrder[],
      sorter: (a, b) => sorter(a[m.name], b[m.name], m.type),
      showSorterTooltip: false,
      ellipsis: true,
      className: "whitespace-nowrap",
      render: (text, record, index) => {
        return <div style={{ minWidth: m.name === "#" ? 25 : 130 }}>{text}</div>;
      },
    }));
  }, [results.meta]);

  return (
    <Layout className={"w-full h-full"} rootClassName={styles.container}>
      <Content className={"w-full flex flex-col"}>
        <div className="border border-backgroundDark px-3 py-2 text-xl rounded-t flex items-center">
          <div className="h-6 w-6 mr-2">
            <ClickhouseIcon />
          </div>

          <div>Query Clickhouse</div>
        </div>
        <div className="relative h-52 px-3 py-1 z-0 border-b border-l border-r border-backgroundDark rounded-b">
          <div className="absolute top-0.5 right-0 z-10 pt-2 pr-4  flex flex-col items-end space-y-4">
            <ExpandableButton icon={<Play />} onClick={() => runNewQuery(sql, SQLQueryDefaultLimit)}>
              Run Query
            </ExpandableButton>
            <ExpandableButton icon={<FolderTree />} onClick={() => setShowSider(!showSider)}>
              {showSider ? "Hide" : "Show"} tables
            </ExpandableButton>
          </div>
          <CodeEditor
            language={"sql"}
            value={sql}
            onChange={setSql}
            changePosition={setCursorPosition}
            ctrlEnterCallback={runNewQuery}
            monacoOptions={{ lineNumbers: "off", renderLineHighlight: "none", lineDecorationsWidth: 0 }}
          />
        </div>

        {!error ? (
          results?.rows > 0 || loading ? (
            <>
              <div className={"w-full mt-2 h-full flex-auto overflow-auto"}>
                {loading ? (
                  <div className="h-full w-full flex flex-col justify-start items-center">
                    <LoadingAnimation className="text-primary" hideTitle={true} />
                  </div>
                ) : (
                  <Table
                    sortDirections={["ascend", "descend"]}
                    size={"small"}
                    className={"h-full "}
                    scroll={{ x: true, y: "100%" }}
                    columns={columns}
                    pagination={false}
                    rowKey={"#"}
                    bordered={true}
                    sticky={true}
                    dataSource={results.data}
                  />
                )}
              </div>
              <div className={"table-footer text-right w-full flex flex-row justify-between"}>
                {lastQuery && (
                  <>
                    <LabelEllipsis maxLen={50}>{lastQuery.sql.replaceAll("\n", " ")}</LabelEllipsis>
                    <div>
                      <Button
                        type="primary"
                        ghost
                        className={"mr-2"}
                        icon={<LeftOutlined />}
                        size={"small"}
                        disabled={lastQuery.offset === 0}
                        title={"Previous"}
                        onClick={() =>
                          runQuery(lastQuery.sql, Math.max(0, lastQuery.offset - lastQuery.limit), lastQuery.limit)
                        }
                      ></Button>
                      <span>
                        Rows: {(lastQuery?.offset ?? 0) + 1}…{(lastQuery?.offset ?? 0) + results.rows}
                      </span>
                      <Button
                        type="primary"
                        ghost
                        className={"ml-2"}
                        icon={<RightOutlined />}
                        size={"small"}
                        disabled={results.rows !== lastQuery.limit}
                        title={"Next"}
                        onClick={() => runQuery(lastQuery.sql, lastQuery.offset + lastQuery.limit, lastQuery.limit)}
                      ></Button>
                    </div>
                  </>
                )}
                &nbsp; Elapsed: {(results.statistics["elapsed"] as any)?.toFixed(3)}s.
              </div>
            </>
          ) : (
            <div className={"bg-transparent rw-full mt-2 h-full flex-auto overflow-auto"}>
              <div className={"flex flex-col h-full"}>
                {results.statistics["elapsed"] ? (
                  <div className={"jitsu-label"}>
                    {`Rows: ${results.rows}   Elapsed: ${(results.statistics["elapsed"] as any)?.toFixed(3)}s.`}
                  </div>
                ) : (
                  <></>
                )}
                <div className={"flex-auto"}>
                  <div
                    className={
                      "flex flex-col h-full content-center justify-center border border-dashed border-backgroundDark"
                    }
                  >
                    <Empty
                      description={results.statistics["elapsed"] ? "Empty result" : "No results. Run your query"}
                      className="py-12 rounded-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className={"w-full mt-2"}>
            <Alert message={error.response?.error || `${error}`} type="error" showIcon />
          </div>
        )}
      </Content>
      <Sider
        className={"rounded-lg pl-2 h-full overflow-auto bg-transparent"}
        collapsed={!showSider}
        collapsible={true}
        collapsedWidth={0}
        zeroWidthTriggerStyle={{ display: "none" }}
        theme={"light"}
        width={300}
      >
        <SchemaTree
          destinationId={destinationId}
          onTableSelect={t =>
            setSql(`SELECT *
                    FROM ${t};
            ${sql}`)
          }
          onColumnSelect={c => setSql(`${sql.substring(0, cursorPosition)}${c},${sql.substring(cursorPosition)}`)}
        />
      </Sider>
    </Layout>
  );
};

export default SQLViewer;

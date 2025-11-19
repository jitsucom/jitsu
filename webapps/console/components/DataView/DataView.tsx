import { useQueryStringState } from "../../lib/useQueryStringState";
import JSON5 from "json5";
import { Tabs, TabsProps } from "antd";
import React, { useCallback } from "react";
import { EventsBrowser } from "./EventsBrowser";
import { ArrowDownCircle, Database, Layers, XCircle } from "lucide-react";

export type DataViewState = {
  activeView: "incoming" | "function" | "bulker" | "dead-letter";
  viewState: Record<"incoming" | "function" | "bulker" | "dead-letter", any>;
};

export function DataView() {
  const defaultState: DataViewState = {
    activeView: "incoming",
    //state of nested Tab
    viewState: {
      incoming: {},
      function: {},
      bulker: {},
      "dead-letter": {},
    },
  };
  const [state, setState] = useQueryStringState<DataViewState>(`query`, {
    defaultValue: defaultState,
    parser: (value: string) => {
      return JSON5.parse(value);
    },
    serializer: (value: DataViewState) => {
      return JSON5.stringify(value);
    },
  });

  const changeActiveView = (activeView: string) =>
    setState({ ...state, activeView: activeView as DataViewState["activeView"] });

  const patchQueryStringState = useCallback(
    (key: string, value: any) => {
      if (state.viewState[state.activeView]?.[key] === value) return;
      if (value === null) {
        const newState = { ...state };
        delete newState[key];
        setState(newState);
      } else {
        setState({
          ...state,
          viewState: { ...state.viewState, [state.activeView]: { ...state.viewState[state.activeView], [key]: value } },
        });
      }
    },
    [setState, state]
  );

  const items: TabsProps["items"] = [
    {
      key: "incoming",
      label: (
        <span className="flex items-center gap-2">
          <ArrowDownCircle className="w-4 h-4" />
          Incoming Events
        </span>
      ),
      children: (
        <EventsBrowser
          {...state.viewState.incoming}
          streamType={"incoming"}
          patchQueryStringState={patchQueryStringState}
        />
      ),
    },
    {
      key: "function",
      label: (
        <span className="flex items-center gap-2">
          <Layers className="w-4 h-4" />
          API Destinations & Functions Logs
        </span>
      ),
      children: (
        <EventsBrowser
          {...state.viewState.function}
          streamType={"function"}
          patchQueryStringState={patchQueryStringState}
        />
      ),
    },
    {
      key: "bulker",
      label: (
        <span className="flex items-center gap-2">
          <Database className="w-4 h-4" />
          Batches & Data Warehouse Events
        </span>
      ),
      children: (
        <EventsBrowser
          {...state.viewState.bulker}
          streamType={"bulker"}
          patchQueryStringState={patchQueryStringState}
        />
      ),
    },
    {
      key: "dead-letter",
      label: (
        <span className="flex items-center gap-2">
          <XCircle className="w-4 h-4" />
          Unrecoverable Events
        </span>
      ),
      children: (
        <EventsBrowser
          {...state.viewState["dead-letter"]}
          streamType={"dead-letter"}
          patchQueryStringState={patchQueryStringState}
        />
      ),
    },
    // {
    //   key: "sql",
    //   label: `SQL Viewer`,
    //   children: <SQLViewer patchQueryStringState={patchQueryStringState} />,
    // },
  ];
  return (
    <Tabs
      defaultActiveKey={state.activeView}
      onChange={changeActiveView}
      destroyInactiveTabPane={true}
      type="line"
      items={items}
    />
  );
}

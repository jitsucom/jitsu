import { UseQueryResult } from "@tanstack/react-query/src/types";
import { ReactNode, useEffect } from "react";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { GlobalError } from "../GlobalError/GlobalError";

type QueryResultDisplay<T = any> = {
  render: (data: T) => ReactNode;
  errorTitle?: string;
  errorRender?: (error: any) => ReactNode;
  prepare?: (data: T) => void;
};

type QueryResponseProps<T = any, E = any> = {
  result: UseQueryResult<T, E>;
  render: (data: T) => ReactNode;
} & QueryResultDisplay<T>;

export function QueryResponse(props: QueryResponseProps) {
  const { result, render } = props;
  useEffect(() => {
    if (!result.isLoading && result.data && props.prepare) {
      props.prepare(result.data);
    }
  }, [result.data, props.prepare, result.isLoading, props]);

  if (result.isLoading) {
    return <LoadingAnimation title="Waiting for server..." />;
  }
  if (result.error) {
    if (props.errorRender) {
      return <>{props.errorRender(result.error)}</>;
    }
    return <GlobalError title={props.errorTitle || "Failed to load data from server"} error={result.error} />;
  }
  return <>{render(result.data)}</>;
}

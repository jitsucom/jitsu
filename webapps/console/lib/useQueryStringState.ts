import { useRouter } from "next/router";
import { useCallback, useState } from "react";

export type Serde<T> = {
  parser: (val: string) => T;
  serializer: (val: T) => string;
};

export const jsonSerialization: Serde<any> = {
  parser: (val: string) => JSON.parse(val),
  serializer: (val: any) => JSON.stringify(val),
};

export const jsonSerializationBase64: Serde<any> = {
  parser: (val: string) => JSON.parse(atob(val)),
  serializer: (val: string) => btoa(JSON.stringify(val)),
};

export function useQueryStringState<T = string | undefined>(
  param: string,
  opt: { defaultValue?: T } & Partial<Serde<T>> = {
    defaultValue: undefined as T,
    parser: (val: string) => val as T,
    serializer: (val: T) => (val || "").toString(),
  }
): [T, (val: T) => void] {
  const { push, query } = useRouter();
  const initialValueStr = query[param] as string | undefined;
  const initialValue = initialValueStr
    ? opt.parser
      ? opt.parser(initialValueStr)
      : (initialValueStr as T)
    : opt.defaultValue;

  const [state, setState] = useState<T>(initialValue as T);
  const updateState = useCallback(
    (val: T) => {
      setState(val);
      const newQuery = { ...query, [param]: opt.serializer ? opt.serializer(val) : (val as string) };
      return push({ query: newQuery }, undefined, { shallow: true });
    },
    [opt, param, query, push]
  );
  return [state, updateState];
}

import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import omit from "lodash/omit";

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
  opt: { defaultValue?: T; skipHistory?: boolean } & Partial<Serde<T>> = {
    defaultValue: undefined as T,
    parser: (val: string) => val as T,
    serializer: (val: T) => (val || "").toString(),
  }
): [T, (val: T) => Promise<boolean>] {
  const { push, replace, query } = useRouter();
  const transition = opt.skipHistory ? replace : push;
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
      if (val) {
        const newQuery = { ...query, [param]: opt.serializer ? opt.serializer(val) : (val as string) };
        return transition({ query: newQuery }, undefined, { shallow: true });
      } else {
        return transition({ query: omit(query, param) }, undefined, { shallow: true });
      }
    },
    [opt, param, query, transition]
  );
  return [state, updateState];
}

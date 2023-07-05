import { PropsWithChildren, ReactNode, useCallback, useEffect, useState } from "react";
import { notification } from "antd";
import { NextRouter, useRouter } from "next/router";
import { assertTrue } from "juava";
import { ErrorDetails } from "../components/GlobalError/GlobalError";
import { getAntdModal } from "./modal";

import * as _useTitle from "react-use/lib/useTitle";
import { NotificationPlacement } from "antd/es/notification/interface";

export type KeyboardKey = "Escape" | "Enter";

export function useKeyboard(key: KeyboardKey, handler) {
  const onKeyPress = useCallback(
    event => {
      if (event.key === key) {
        handler();
      }
    },
    [handler, key]
  );

  useEffect(() => {
    document.addEventListener("keydown", onKeyPress, false);

    return () => {
      document.removeEventListener("keydown", onKeyPress, false);
    };
  }, [onKeyPress]);
}

export const useTitle = _useTitle.default;

export function copyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    var successful = document.execCommand("copy");
    var msg = successful ? "successful" : "unsuccessful";
    console.log("Fallback: Copying text command was " + msg);
  } catch (err) {
    console.error("Fallback: Oops, unable to copy", err);
  }

  document.body.removeChild(textArea);
}

export type PropsWithChildrenClassname<T = {}> = PropsWithChildren<T> & { className?: string };

export type Action = string | (() => any | Promise<any>);

export function doAction(router: NextRouter, action: Action) {
  if (typeof action === "string") {
    router.push(action);
  } else {
    action();
  }
}

export function confirmOp(message: ReactNode) {
  return new Promise(resolve => {
    getAntdModal().confirm({
      title: message,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export type Serialization<T = any> = { parser?: (val: string) => T; serializer?: (val: T) => string };

export const serialization = {
  str: { parser: (val: string) => val, serializer: (val: string) => val },
  json: { parser: (val: string) => JSON.parse(val), serializer: (val: any) => JSON.stringify(val) },
  bool: { parser: (val: string) => val === "true", serializer: (val: boolean) => val.toString() },
};

export function useURLPersistedState<T = any>(
  paramName: string,
  opts: Serialization<T> & { defaultVal?: T; type?: Serialization<T> } = { type: serialization.json }
): [T, (val: T) => void] {
  const router = useRouter();
  const parser = opts.parser || opts.type?.parser || serialization.json.parser;
  const serializer = opts?.serializer || opts.type?.serializer || serialization.json.serializer;
  const paramValue = router.query[paramName];
  assertTrue(typeof paramValue !== "object", `Invalid param '${paramName}' type: ${paramValue}`);
  const [value, setValue] = useState(paramValue ? parser(paramValue as string) : opts?.defaultVal);

  const setPersistedValue = val => {
    setValue(val);
    router.replace({
      pathname: router.pathname,
      query: { ...(router.query || {}), [paramName]: serializer(val) },
    });
  };

  return [value, setPersistedValue];
}

export function feedbackSuccess(message: ReactNode) {
  notification.success({
    message,
    placement: "bottomRight",
  });
}

export function feedbackError(message: ReactNode, opts?: { error?: any; placement?: NotificationPlacement }) {
  notification.error({
    message: message,
    placement: opts?.placement || "bottomRight",
    description: opts?.error ? (
      <>
        <div
          className="cursor-pointer text-sm text-primary"
          onClick={() => {
            getAntdModal().error({
              bodyStyle: { maxHeight: "80vh", overflow: "auto" },
              width: "90vw",
              title: message,
              content: <ErrorDetails error={opts?.error} />,
            });
          }}
        >
          Show details
        </div>
      </>
    ) : undefined,
  });
}

export function useUnsavedChanges(notSaved: boolean, opts?: { message?: string }) {
  const router = useRouter();
  useEffect(() => {
    const confirmationMessage = opts?.message || "You have unsaved changes, are you sure you want to leave?";
    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      (e || window.event).returnValue = confirmationMessage;
      return confirmationMessage; // Gecko + Webkit, Safari, Chrome etc.
    };
    const beforeRouteHandler = (url: string) => {
      if (router.pathname !== url && !confirm(confirmationMessage)) {
        // to inform NProgress or something ...
        router.events.emit("routeChangeError");
        // tslint:disable-next-line: no-string-throw
        throw `Route change to "${url}" was aborted (this error can be safely ignored). See https://github.com/zeit/next.js/issues/2476.`;
      }
    };
    if (notSaved) {
      window.addEventListener("beforeunload", beforeUnloadHandler);
      router.events.on("routeChangeStart", beforeRouteHandler);
    } else {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      router.events.off("routeChangeStart", beforeRouteHandler);
    }
    return () => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      router.events.off("routeChangeStart", beforeRouteHandler);
    };
  }, [notSaved, opts?.message, router.events, router.pathname]);
}

function findScript(src: string): HTMLScriptElement | undefined {
  const scripts = Array.prototype.slice.call(window.document.querySelectorAll("script"));
  return scripts.find(s => s.src === src);
}

export type ScriptOptions = {
  attributes?: Record<string, string>;
  www?: boolean;
  js?: boolean;
  min?: boolean;
  query?: string;
};

function buildScriptSrc(src: string, options?: ScriptOptions): string {
  let result = src;
  if (!result.startsWith("http")) {
    result = `https://${options?.www ? "www." : ""}${result}`;
  }
  if (options?.min) {
    result = result + ".min.js";
  } else if (options?.js) {
    result = result + ".js";
  }

  if (options?.query) {
    result += "?" + options.query;
  }
  return result;
}

export function loadScript(src: string, options?: ScriptOptions): Promise<HTMLScriptElement> {
  const found = findScript(src);

  if (found !== undefined) {
    const status = found?.getAttribute("status");

    if (status === "loaded") {
      return Promise.resolve(found);
    }

    if (status === "loading") {
      return new Promise((resolve, reject) => {
        found.addEventListener("load", () => resolve(found));
        found.addEventListener("error", err => reject(err));
      });
    }
  }

  return new Promise((resolve, reject) => {
    const script = window.document.createElement("script");

    script.type = "text/javascript";
    script.src = buildScriptSrc(src, options);
    script.async = true;

    script.setAttribute("status", "loading");
    for (const [k, v] of Object.entries(options?.attributes ?? {})) {
      script.setAttribute(k, v);
    }

    script.onload = (): void => {
      script.onerror = script.onload = null;
      script.setAttribute("status", "loaded");
      resolve(script);
    };

    script.onerror = (): void => {
      script.onerror = script.onload = null;
      script.setAttribute("status", "error");
      reject(new Error(`Failed to load ${src}`));
    };

    const tag = window.document.getElementsByTagName("script")[0];
    tag.parentElement?.insertBefore(script, tag);
  });
}

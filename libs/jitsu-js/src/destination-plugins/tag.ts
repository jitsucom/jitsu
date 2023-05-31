import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";
import { isInBrowser, randomId } from "../analytics-plugin";

export type TagDestinationCredentials = {
  code: string;
} & CommonDestinationCredentials;

export const tagPlugin: InternalPlugin<TagDestinationCredentials> = {
  id: "tag",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    insertTags(config.code, payload);
  },
};

function insertTags(code, event: AnalyticsClientEvent, opts: { debug?: boolean } = {}) {
  let tag;
  try {
    tag = JSON.parse(code);
  } catch (e) {
    tag = { code, lang: "javascript" };
  }
  const debug = opts.debug || false;
  if (isInBrowser()) {
    if (tag.lang === "javascript") {
      execJs(tag.code, event);
    } else {
      const codeHolder = document.createElement("span");
      codeHolder.innerHTML = replaceMacro(tag.code, event);
      document.body.insertAdjacentElement("beforeend", codeHolder);
      const scripts = codeHolder.querySelectorAll("script");
      scripts.forEach(script => {
        const scriptClone = document.createElement("script");
        scriptClone.type = scriptClone.type || "text/javascript";
        if (script.hasAttribute("src")) {
          scriptClone.src = script.src;
        }
        scriptClone.text = script.text;
        if (debug) {
          console.log(
            `[JITSU] Executing script${script.hasAttribute("src") ? ` ${script.src}` : ""}`,
            scriptClone.text
          );
        }
        document.head.appendChild(scriptClone);
        document.head.removeChild(scriptClone);
      });
    }
  } else {
    if (debug) {
      console.log(`[JITSU] insertTags(): cannot insert tags in non-browser environment`);
    }
  }
}

function execJs(code: string, event: any) {
  const varName = `jitsu_event_${randomId()}`;
  window[varName] = event;
  const iif = `(function(){
      const event = ${varName};
      ${code}
  })()`;
  try {
    eval(iif);
  } catch (e) {
    console.error(`[JITSU] Error executing JS code: ${e.message}. Code: `, iif);
  } finally {
    delete window[varName];
  }
  return iif;
}

function replaceMacro(code, event) {
  return code.replace(/{{\s*event\s*}}/g, JSON.stringify(event));
}

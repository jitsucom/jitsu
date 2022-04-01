import { getLogger } from './log';
import { JitsuClient, JitsuFunction, JitsuOptions } from './interface';
import { jitsuClient } from './jitsu';

const jsFileName = "lib.js"
//Make sure that all properties form JitsuOptions are listed here
const jitsuProps = [
  'use_beacon_api', 'cookie_domain', 'tracking_host', 'cookie_name',
  'key', 'ga_hook', 'segment_hook', 'randomize_url', 'capture_3rd_party_cookies',
  'id_method', 'log_level', 'compat_mode','privacy_policy', 'cookie_policy', 'ip_policy', 'custom_headers',
  'force_use_fetch'
];


function getTrackingHost(scriptSrc: string): string {
  return scriptSrc.replace("/s/" + jsFileName, "").replace("/" + jsFileName, "");
}

const supressInterceptionWarnings = "data-suppress-interception-warning";

function hookWarnMsg(hookType: string) {
  return `
      ATTENTION! ${hookType}-hook set to true along with defer/async attribute! If ${hookType} code is inserted right after Jitsu tag,
      first tracking call might not be intercepted! Consider one of the following:
       - Inject jitsu tracking code without defer/async attribute
       - If you're sure that events won't be sent to ${hookType} before Jitsu is fully initialized, set ${supressInterceptionWarnings}="true"
       script attribute
    `;
}

function getTracker(window): JitsuClient {

  let script = document.currentScript
    || document.querySelector('script[src*=jsFileName][data-jitsu-api-key]');

  if (!script) {
    getLogger().warn("Jitsu script is not properly initialized. The definition must contain data-jitsu-api-key as a parameter")
    return undefined;
  }
  let opts: JitsuOptions = {
    tracking_host: getTrackingHost(script.getAttribute('src')),
    key: null
  };

  jitsuProps.forEach(prop => {
    let attr = "data-" + prop.replace(new RegExp("_", "g"), "-");
    if (script.getAttribute(attr) !== undefined && script.getAttribute(attr) !== null) {
      let val: any = script.getAttribute(attr);
      if ("true" === val) {
        val = true;
      } else if ("false" === val) {
        val = false;
      }
      opts[prop] = val;
    }
  })
  window.jitsuClient = jitsuClient(opts)
  if (opts.segment_hook && (script.getAttribute('defer') !== null || script.getAttribute('async') !== null) && script.getAttribute(supressInterceptionWarnings) === null) {
    getLogger().warn(hookWarnMsg("segment"))
  }
  if (opts.ga_hook && (script.getAttribute('defer') !== null || script.getAttribute('async') !== null) && script.getAttribute(supressInterceptionWarnings) === null) {
    getLogger().warn(hookWarnMsg("ga"))
  }

  const jitsu: JitsuFunction = function() {
    let queue = window.jitsuQ = window.jitsuQ || [];
    queue.push(arguments)
    processQueue(queue, window.jitsuClient);
  }
  window.jitsu = jitsu;

  if ("true" !== script.getAttribute("data-init-only") && "yes" !== script.getAttribute("data-init-only")) {
    jitsu('track', 'pageview');
  }
  return window.jitsuClient;
}

function processQueue(queue: any[], jitsuInstance: JitsuClient) {
  getLogger().debug("Processing queue", queue);
  for (let i = 0; i < queue.length; i += 1) {
    const [methodName, ...args] = ([...queue[i]] || []);
    const method = (jitsuInstance as any)[methodName];
    if (typeof method === 'function') {
      method.apply(jitsuInstance, args);
    }
  }
  queue.length = 0;
}

if (window) {
  let win = window as any;
  let tracker = getTracker(win);
  if (tracker) {
    getLogger().debug("Jitsu in-browser tracker has been initialized")
    win.jitsu = function() {
      let queue = win.jitsuQ = win.jitsuQ || [];
      queue.push(arguments)
      processQueue(queue, tracker);
    }
    if (win.jitsuQ) {
      getLogger().debug(`Initial queue size of ${win.jitsuQ.length} will be processed`);
      processQueue(win.jitsuQ, tracker);
    }
  } else {
    getLogger().error("Jitsu tracker has not been initialized (reason unknown)")
  }
} else {
  getLogger().warn("Jitsu tracker called outside browser context. It will be ignored")
}



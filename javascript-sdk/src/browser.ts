import { getLogger } from './log';
import { JitsuClient, JitsuOptions } from './interface';
import { jitsuClient } from './jitsu';

const jsFileName = "lib.js"
//Make sure that all properties form JitsuOptions are listed here
const jitsuProps = ['use_beacon_api', 'cookie_domain', 'tracking_host', 'cookie_name', 'key', 'ga_hook', 'segment_hook', 'randomize_url', 'capture_3rd_party_cookies', 'id_method', 'log_level'];


function getTrackingHost(scriptSrc: string): string {
  return scriptSrc.replace("/" + jsFileName, "");
}

function getTracker(window): JitsuClient {
  let script = document.currentScript
    || document.querySelector('script[src*=jsFileName][data-jitsu-api-key]');
  if (!script) {
    getLogger().warn("Jitsu script is not properly initialized. The definition must contain data-jitsu-api-key as a parameter")
    return undefined;
  }
  let opts: JitsuOptions = {
    tracking_host: getTrackingHost(script.getAttribute('src'));
  };

  jitsuProps.forEach(prop => {
    let attr = "jitsu-" + prop.replace("_", "-");
    if (script.getAttribute(attr) !== undefined) {
      opts[prop] = script.getAttribute(attr);
    }
  })
  window.jitsuClient = jitsuClient(opts)
  window.jitsu = function() {
    let queue = window.jitsuQ = window.jitsuQ || [];
    queue.push(arguments)
    processQueue(queue, window.jitsuClient);
  }
}

function processQueue(queue: any[], jitsuInstance: JitsuClient) {
  for (let i = 0; i < queue.length; i += 1) {
    const [methodName, ...args] = (queue[i] || []);
    const method = (jitsuInstance as any)[methodName];
    if (typeof method === 'function') {
      method.apply(jitsuInstance, args);
    }
  }
}

if (window) {
  let win = window as any;
  let tracker = getTracker(win);
  if (tracker) {
    win.jitsu = function() {
      let queue = win.jitsuQ = win.jitsuQ || [];
      queue.push(arguments)
      processQueue(queue, tracker);
    }
  }
} else {
  getLogger().warn("Jitsu tracker called outside browser context")
}



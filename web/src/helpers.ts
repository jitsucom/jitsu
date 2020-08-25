export const getCookieDomain = () => {
  return location.hostname.replace('www.', '');
};

export const getCookie = (name: string) => {
  if (!name) {
    return null;
  }
  return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(name).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
};

export const setCookie = (name: string, value: string, expire: number, domain: string, secure: boolean) => {
  const expireString = expire === Infinity ? "; expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + expire;
  document.cookie = encodeURIComponent(name) + "=" + value + expireString + (domain ? "; domain=" + domain : "") + (secure ? "; secure" : "");
  console.log(encodeURIComponent(name) + "=" + value + expireString + (domain ? "; domain=" + domain : "") + (secure ? "; secure" : ""))
};

export const generateId = () => Math.random().toString(36).substring(2, 12);

export const parseQuery = (qs?: string) => {
  let queryString = qs || window.location.search.substring(1)
  let query: Record<string, string> = {};
  let pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
  for (let i = 0; i < pairs.length; i++) {
    let pair = pairs[i].split('=');
    query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
  }
  return query;
};

const UTM_TYPES: Record<string, string> = {
  utm_source: "source",
  utm_medium: "medium",
  utm_campaign: "campaign",
  utm_term: "term",
  utm_content: "content"
};

const CLICK_IDS: Record<string, boolean> = {
  gclid: true,
  fbclid: true,
};

export const getDataFromParams = (params: Record<string, string>) => {
  const result = {
    utm: {} as Record<string, string>,
    click_id: {} as Record<string, any>
  }
  for (let name in params) {
    if (!params.hasOwnProperty(name)) {
      continue;
    }
    const val = params[name];
    const utm = UTM_TYPES[name];
    if (utm) {
      result.utm[utm] = val;
    } else if (CLICK_IDS[name]) {
      result.click_id[name] = params;
    }
  }
  return result;
}

export const getHostWithProtocol = (host: string) => {
  return '//' + host.replace(/^https?:/, '').replace(/^\/\//, '');
};

export const awaitGlobalProp = (prop: string, timeout = 500, retries = 4) => new Promise(
  (resolve, reject) => {
    const val = (window as any)[prop];
    if (val) {
      resolve(val);
      return;
    }
    if (retries === 0) {
      reject(`window.${prop} does not exist`);
      return;
    }
    setTimeout(
      () => {
        awaitGlobalProp(prop, timeout, retries - 1).then(resolve).catch(reject);
      },
      timeout
    )
  },
);

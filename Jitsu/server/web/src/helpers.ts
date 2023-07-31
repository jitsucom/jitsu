export const getCookieDomain = () => {
    return location.hostname.replace('www.', '');
};

let cookieParsingCache: Record<string, string>;

export const getCookies = (useCache: boolean = false): Record<string, string> => {
    if (useCache && cookieParsingCache) {
        return cookieParsingCache;
    }
    let res: Record<string, string> = {};

    let cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
        let cookie = cookies[i];
        let idx = cookie.indexOf('=');
        if (idx > 0) {
            res[cookie.substr(i > 0 ? 1 : 0, i > 0 ? idx-1 : idx)] = cookie.substr(idx + 1);
        }
    }
    cookieParsingCache = res;
    return res;

}

export const getCookie = (name: string) => {
    if (!name) {
        return null;
    }
    return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(name).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
};

export const setCookie = (name: string, value: string, expire: number, domain: string, secure: boolean) => {
    const expireString = expire === Infinity ? " expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + expire;
    document.cookie = encodeURIComponent(name) + "=" + value + "; path=/;" +  expireString + (domain ? "; domain=" + domain : "") + (secure ? "; secure" : "");
};

export const generateId = () => Math.random().toString(36).substring(2, 12);

export const generateRandom = () => Math.random().toString(36).substring(2, 7);

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
    dclid: true
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
            result.click_id[name] = val;
        }
    }
    return result;
}

//2020-08-24T13:42:16.439Z -> 2020-08-24T13:42:16.439123Z
export const reformatDate = (strDate: string) => {
    const end = strDate.split('.')[1];
    if (!end) {
        return strDate;
    }
    if (end.length >= 7) {
        return strDate;
    }
    return strDate.slice(0, -1) + '0'.repeat(7 - end.length) + 'Z';
};

function endsWith(str: string, suffix: string) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

export const getHostWithProtocol = (host: string) => {
    while (endsWith(host, "/")) {
        host = host.substr(0, host.length - 1);
    }
    if (host.indexOf("https://") === 0 || host.indexOf("http://") === 0) {
        return host;
    } else {
        return "//" + host
    }
};

export function awaitCondition<T>(
    condition: () => boolean,
    factory: () => T,
    timeout = 500,
    retries = 4
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        if (condition()) {
            resolve(factory());
            return;
        }
        if (retries === 0) {
            reject('condition rejected');
            return;
        }
        setTimeout(
            () => {
                awaitCondition(condition, factory, timeout, retries - 1).then(resolve).catch(reject);
            },
            timeout
        )
    });
}


export function awaitGlobalProp(prop: string, timeout = 500, retries = 4) {
    return awaitCondition(
        () => {
            return (window as any)[prop] !== undefined
        },
        () => {
            return (window as any)[prop]
        },
        timeout, retries
    );
}
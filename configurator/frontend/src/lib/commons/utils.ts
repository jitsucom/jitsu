/* eslint-disable */
import { message } from 'antd';

export function concatenateURLs(baseUrl: string, url: string) {
  let base = baseUrl.endsWith('/') ? baseUrl.substr(0, baseUrl.length - 1) : baseUrl;
  return base + (url.startsWith('/') ? url : '/' + url);
}


function circularReferencesReplacer() {
  let cache = [];
  return (key, value) => {
    if (typeof value === 'object' && value !== null) {
      // Duplicate reference found, discard key
      if (cache.includes(value)) return;

      // Store value in our collection
      cache.push(value);
    }
    return value;
  };
}

/**
 * Enhanced alert. Displays JSON representation of the
 * object and logs a copy to console
 */
export function alert(...object) {
  if (object.length === 1) {
    console.log('Object:', object[0]);
    window.alert(JSON.stringify(object[0], circularReferencesReplacer(), 4));
  } else {
    console.log('Object:', object);
    window.alert(JSON.stringify(object, circularReferencesReplacer(), 4));
  }
}

export function isNullOrUndef(val) {
  return val === null || val === undefined;
}

export function withDefaultVal<T>(val: T, defaultVal: T): T {
  return isNullOrUndef(val) ? defaultVal : val;
}

/**
 * First letter of string to lower ("Hello world!" -> "hello world").
 * Useful for nice messages display
 */
export function firstToLower(string: string) {
  if (string.length > 0) {
    return string.charAt(0).toLowerCase() + string.slice(1);
  }
  return string;
}

/**
 * Fully reloads current page
 */
export function reloadPage() {
  location.reload();
}

type INumberFormatOpts = {};

type Formatter = (val: any) => string;

export function numberFormat(opts?: INumberFormatOpts | any): any {
  if (opts == undefined) {
    return numberFormat({});
  } else if (typeof opts === 'object') {
    return (x) => {
      if (x === undefined) {
        return 'N/A';
      }
      return x.toLocaleString();
      //return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
    };
  } else {
    let formatter: Formatter = numberFormat({});
    return formatter(opts);
  }
}

export function withDefaults<T>(obj: T, defaults: Partial<T>): T {
  return { ...defaults, ...obj };
}

export function sleep(ms, retVal?: any | Error): Promise<void> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (retVal instanceof Error) {
        reject(retVal);
      } else {
        resolve(retVal);
      }
    }, ms)
  );
}

export function copyToClipboard(value, unescapeNewLines?: boolean) {
  const el = document.createElement('textarea');

  el.value = unescapeNewLines ? value.replace('\\\n', '') : value;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

/* eslint-disable */
import { message } from 'antd';

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

export function randomId(len?: number) {
  let str = Math.random().toString(36).substring(2, len) + Math.random().toString(36).substring(2, 15);
  return len ? str.substr(0, len) : str;
}

/**
 *
 */
export class IndexedList<T> {
  private readonly indexF: (T) => string;
  private index: Record<string, number>;
  private list: T[];

  constructor(indexF: (T) => string);
  constructor(indexF: (T) => string, ...items: T[]) {
    this.indexF = indexF;
    this.index = {};
    this.list = [];
    items.forEach((item) => this.pushSingle(item));
  }

  public toArray(): T[] {
    return this.list;
  }

  public pushSingle(item: T): void {
    let key = this.indexF(item);
    if (this.index[key] !== undefined) {
      throw new Error('Duplicate key ' + key);
    }
    this.list.push(item);
    this.index[key] = this.list.length - 1;
  }

  public push(...items: T[]): IndexedList<T> {
    items.forEach((item) => this.pushSingle(item));
    return this;
  }

  public remove(key: string): T {
    let index = this.index[key];
    if (index === undefined) {
      return undefined;
    } else {
      delete this.index[key];
      let result = this.list[index];
      this.list = this.list.filter((item, i) => i != index);
      return result;
    }
  }
  public addOrUpdate(item: T): IndexedList<T> {
    let existingIndex = this.index[this.indexF(item)];
    if (existingIndex === undefined) {
      this.push(item);
    } else {
      this.list[existingIndex] = item;
    }
    return this;
  }
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

/**
 * Represents a path to a current application page
 * with parameters. Takes care of parsing it from hash or window location.
 *
 * Arrays are nit supported
 */
export class RoutePath {
  private readonly _path: string;
  private readonly _params: Record<string, any>;

  constructor(path: string) {
    path = this.cleanPath(path);
    let paramsStart = path.indexOf('?');
    if (paramsStart >= 0 && paramsStart < path.length - 1) {
      this._path = this.cleanPath(path.substr(0, paramsStart));
      this._params = this.parseParams(path.substr(paramsStart + 1));
    } else {
      this._path = path;
      this._params = {};
    }
  }

  private parseParams(s: string): Record<string, any> {
    let vars = s.split('&');
    let res = {};
    for (let i = 0; i < vars.length; i++) {
      const [key, value] = this.parsePair(vars[i]);
      res[key] = value;
    }
    return res;
  }

  private cleanPath(path: string): string {
    let start = 0;
    let end = path.length - 1;
    while ((start <= end && path.charAt(start) === '/') || path.charAt(start) === '#') {
      start++;
    }

    while ((start <= end && path.charAt(end) === '/') || path.charAt(end) === '?') {
      end--;
    }
    return path.substr(start, end + 1);
  }

  private parsePair(string: string): [string, any] {
    let idx = string.indexOf('=');
    if (idx === 0) {
      throw new Error(`Invalid key=value pair ${string}`);
    }
    return [
      idx < 0 ? string : string.substr(0, idx),
      idx == string.length - 1 ? null : idx < 0 ? true : string.substr(idx + 1)
    ];
  }

  get path() {
    return this._path;
  }

  get params(): Record<string, any> {
    return this._params;
  }
}

export function toURL(url: string, params: Record<string, any> = {}): string {
  if (Object.keys(params).length) {
    const urlParams = new URLSearchParams(params);
    return `${url}?${urlParams.toString()}`;
  } else {
    return url;
  }
}

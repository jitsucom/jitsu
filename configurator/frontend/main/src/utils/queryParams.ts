export const withQueryParams = (
  baseUrl: string,
  paramsDict?: { [key: string]: string },
  options?: { encode?: string[] }
): string => {
  return !paramsDict
    ? baseUrl
    : Object.entries(paramsDict)
        .reduce((accumulator, current) => {
          let [key, value] = current
          if (value === null || value === undefined) {
            return accumulator
          }
          if ((options?.encode ?? []).includes(key)) {
            value = encodeURIComponent(value)
          }
          return `${accumulator}${key}=${value}&`
        }, `${baseUrl}?`)
        .slice(0, -1)
}

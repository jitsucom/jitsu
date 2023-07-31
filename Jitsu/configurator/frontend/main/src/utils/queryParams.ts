export const withQueryParams = (
  baseUrl: string,
  paramsDict?: { [key: string]: string },
  options?: { encode?: string[] }
): string => {
  const firstSep = baseUrl.includes("?") ? "&" : "?"
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
        }, `${baseUrl}${firstSep}`)
        .slice(0, -1)
}

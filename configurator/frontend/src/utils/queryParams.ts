export const withQueryParams = (baseUrl: string, paramsDict: { [key: string]: string }): string => {
  return Object.entries(paramsDict)
    .reduce((accumulator, current) => {
      const [key, value] = current
      if (value === null || value === undefined) {
        return accumulator
      }
      return `${accumulator}${key}=${value}&`
    }, `${baseUrl}?`)
    .slice(0, -1)
}

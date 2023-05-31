export type SqlQueryParameters = any[] | Record<string, any>;

/**
 * Converts named parameters to positional parameters
 */
export function namedParameters(query: string, values: SqlQueryParameters = []): { query: string; values: any[] } {
  if (Array.isArray(values)) {
    return { query, values };
  }
  return convertNamedQueryParameters(query, values);
}

export function unrollParams(sql: string, params: any[] = []): string {
  const regex = new RegExp(`\\$(\\d+)`, "g");
  return sql.replace(regex, (match, p) => {
    const val = params[parseInt(p) - 1] || null;
    const quote = typeof val === "number" || val === null ? "" : "'";
    return `${quote}${val}${quote}`;
  });
}

function convertNamedQueryParameters(
  parameterizedSql: string,
  params: Record<string, any>
): { query: string; values: any[] } {
  const regex = new RegExp(`:(${Object.keys(params).join("|")})`, "g");
  const matches = parameterizedSql.matchAll(regex);
  let prevIndex = 0;
  let paramsIndex = 1;
  const paramsArray: any[] = [];
  const queryParts: string[] = [];
  const indexCache = {};
  let result = matches.next();
  while (!result.done) {
    const paramName = result.value[1];
    const index = result.value.index || 0;
    queryParts.push(parameterizedSql.substring(prevIndex, index));
    prevIndex = index + paramName.length + 1;

    let paramIndex = indexCache[paramName];
    if (!paramIndex) {
      paramIndex = paramsIndex++;
      indexCache[paramName] = paramIndex;
      paramsArray.push(params[paramName]);
    }
    queryParts.push(`$${paramIndex}`);

    result = matches.next();
  }
  queryParts.push(parameterizedSql.substring(prevIndex));
  return {
    query: queryParts.join(""),
    values: paramsArray,
  };
}

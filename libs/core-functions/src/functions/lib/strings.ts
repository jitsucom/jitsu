export function idToSnakeCaseRegex(id: string) {
  return id.replace(/((?<=[a-zA-Z0-9])[A-Z])/g, "_$1").toLowerCase();
}

const aCode = "A".charCodeAt(0);
const zCode = "Z".charCodeAt(0);
const _Code = "_".charCodeAt(0);

export function idToSnakeCaseFast(id: string) {
  let res = id[0].toLowerCase();
  let upperIndex = 0;
  let i = 1;
  const firstChar = id.charCodeAt(0);
  let needUnderscore = firstChar != _Code;
  for (; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (c >= aCode && c <= zCode) {
      res += id.substring(upperIndex + 1, i) + (needUnderscore ? "_" : "") + id.charAt(i).toLowerCase();
      upperIndex = i;
    }
    needUnderscore = c != _Code;
  }
  if (upperIndex == 0 && !(firstChar >= aCode && firstChar <= zCode)) {
    return id;
  } else if (upperIndex < i) {
    res += id.substring(upperIndex + 1, id.length);
  }
  return res;
}

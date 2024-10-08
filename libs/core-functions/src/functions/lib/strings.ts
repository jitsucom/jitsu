export function idToSnakeCaseRegex(id: string) {
  return id.replace(/((?<=[a-zA-Z0-9])[A-Z])/g, "_$1").toLowerCase();
}

const ACode = "A".charCodeAt(0);
const ZCode = "Z".charCodeAt(0);
const _Code = "_".charCodeAt(0);
const spaceCode = " ".charCodeAt(0);

export function idToSnakeCaseFast(id: string) {
  let res = "";
  let concatIndex = 0;
  let i = 0;
  let needUnderscore = false;
  for (; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (c >= ACode && c <= ZCode) {
      res += id.substring(concatIndex, i) + (needUnderscore ? "_" : "") + id.charAt(i).toLowerCase();
      concatIndex = i + 1;
    } else if (c == spaceCode) {
      res += id.substring(concatIndex, i) + "_";
      concatIndex = i + 1;
    }
    needUnderscore = c != _Code && c != spaceCode;
  }
  if (concatIndex == 0) {
    return id;
  } else if (concatIndex < i) {
    res += id.substring(concatIndex, i);
  }
  return res;
}

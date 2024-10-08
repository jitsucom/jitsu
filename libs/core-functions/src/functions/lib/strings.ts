export function idToSnakeCaseRegex(id: string) {
  return id.replace(/((?<=[a-zA-Z0-9])[A-Z])/g, "_$1").toLowerCase();
}

const ACode = "A".charCodeAt(0);
const ZCode = "Z".charCodeAt(0);
const aCode = "a".charCodeAt(0);
const zCode = "z".charCodeAt(0);
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
    // needUnderscore is used in case next char is a capital latin letter
    // we add underscore only between latin letters
    needUnderscore = (c >= aCode && c <= zCode) || (c >= ACode && c <= ZCode);
  }
  if (concatIndex == 0) {
    return id;
  } else if (concatIndex < i) {
    res += id.substring(concatIndex, i);
  }
  return res;
}

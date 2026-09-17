const ACode = "A".charCodeAt(0);
const ZCode = "Z".charCodeAt(0);
const aCode = "a".charCodeAt(0);
const zCode = "z".charCodeAt(0);
const zeroCode = "0".charCodeAt(0);
const nineCode = "9".charCodeAt(0);
const spaceCode = " ".charCodeAt(0);
const underscodeCode = "_".charCodeAt(0);

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
    // we add underscore after a latin letter or a digit
    needUnderscore = (c >= aCode && c <= zCode) || (c >= ACode && c <= ZCode) || (c >= zeroCode && c <= nineCode);
  }
  if (concatIndex == 0) {
    return id;
  } else if (concatIndex < i) {
    res += id.substring(concatIndex, i);
  }
  return res;
}

export function idToClassic(id: string) {
  let needConvert = false;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (!((c >= aCode && c <= zCode) || (c >= zeroCode && c <= nineCode) || c == underscodeCode)) {
      needConvert = true;
      break;
    }
  }
  if (!needConvert) {
    return id;
  }
  let res = "";
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (c >= ACode && c <= ZCode) {
      res += id.charAt(i).toLowerCase();
    } else if ((c >= aCode && c <= zCode) || (c >= zeroCode && c <= nineCode)) {
      res += id.charAt(i);
    } else {
      res += "_";
    }
  }
  return res;
}

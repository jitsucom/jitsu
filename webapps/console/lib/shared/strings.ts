export function trimMiddle(str: string, maxLen: number, ellisis = "...") {
  if (str.length <= maxLen) {
    return str;
  } else {
    return str.substring(0, maxLen / 2 - (ellisis.length - 1)) + ellisis + str.substring(str.length - maxLen / 2 + 1);
  }
}

export function trimEnd(str: string, maxLen: number, ellisis = "...") {
  if (str.length <= maxLen) {
    return str;
  } else {
    return str.substring(0, maxLen - (ellisis.length - 1)) + ellisis;
  }
}

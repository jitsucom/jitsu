function getIndentSize(line): number {
  let idx = 0;
  for (; line.charAt(idx) === " " && idx < line.length; idx++) {}
  return idx;
}

/**
 * Finds a common indentation in text and removes it
 */
export function removeIndentation(text: string, { trimLines = true } = {}): string {
  let lines = text.split("\n");
  if (trimLines) {
    let start = 0,
      end = lines.length - 1;
    for (; lines[start].trim().length == 0 && start <= end; start++) {}
    for (; lines[end].trim().length == 0 && end >= start; end--) {}
    lines = lines.slice(start, end + 1);
  }
  let commonIndent = Math.min(...lines.filter(ln => ln.trim().length > 0).map(getIndentSize));

  return lines.map(ln => ln.substring(commonIndent)).join("\n");
}

export function align(text: string, { indent = 0, lnBefore = 0, lnAfter = 0 } = {}) {
  const cleanText = removeIndentation(text, { trimLines: true });
  return [
    ...new Array(lnBefore).fill(""),
    ...cleanText.split("\n").map(ln => " ".repeat(indent) + ln),
    ...new Array(lnAfter).fill(""),
  ].join("\n");
}

export function jsonify(obj: any) {
  if (typeof obj === "string") {
    try {
      return JSON.parse(obj);
    } catch (e) {
      return obj;
    }
  }
  return obj;
}

export const indentCode = (code: string, indent: number): string => {
  return trimCode(code)
    .split("\n")
    .map(l => " ".repeat(indent) + l)
    .join("\n");
};

export function trimCode(code: string) {
  let lines: string[] = code.split("\n");
  while (lines.length > 0 && lines[0].trim() === "") {
    lines = lines.slice(1);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines = lines.slice(0, lines.length - 1);
  }
  if (lines.length > 0) {
    let indent = findCommonIndent(lines[0]);
    if (indent.length > 0) {
      lines = lines.map(line => (line.startsWith(indent) ? line.substr(indent.length) : line));
    }
  }
  return lines.join("\n").trim();
}

export function findCommonIndent(str: string) {
  function isWhitespace(char: string) {
    return char === " " || char === "\t";
  }
  const ident: string[] = [];

  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    if (isWhitespace(char)) {
      ident.push(char);
    } else {
      break;
    }
  }
  return ident.join("");
}

export function camelSplit(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .map(s => s.toLowerCase());
}

import { color } from "./colors";
const chars = {
  topLeft: "┌",
  topRight: "┐",
  bottomRight: "┘",
  bottomLeft: "└",
  vertical: "│",
  horizontal: "─",
};

function stringWidth(str: string): number {
  let width = 0;

  for (const char of Array.from(str)) {
    const codePoint = char.codePointAt(0);

    // Ignore control characters and other non-printable characters
    if (codePoint && (codePoint <= 31 || codePoint === 127)) {
      continue;
    }

    // Basic check for surrogate pairs (common in emojis)
    if (codePoint && codePoint > 0xffff) {
      width += 2; // Assuming emoji width as 2
    } else {
      width += 1;
    }
  }

  return width;
}
export function drawBox({ content }: { content: string | string[] }): string {
  const contentLines = typeof content === "string" ? content.split("\n") : content;
  const maxWidth = Math.max(...contentLines.map(stringWidth));

  const resLines: string[] = [];
  const px = 2;
  const mx = 0;
  resLines.push(
    " ".repeat(mx) + color.gray(chars.topLeft + chars.horizontal.repeat(maxWidth + px * 2) + chars.topRight)
  );

  resLines.push(
    ...contentLines.map(
      line =>
        " ".repeat(mx) +
        color.gray(chars.vertical) +
        " ".repeat(px) +
        line.padEnd(maxWidth, " ") +
        " ".repeat(px) +
        color.gray(chars.vertical)
    )
  );

  resLines.push(
    " ".repeat(mx) + color.gray(chars.bottomLeft + chars.horizontal.repeat(maxWidth + px * 2) + chars.bottomRight)
  );

  return resLines.join("\n");
}

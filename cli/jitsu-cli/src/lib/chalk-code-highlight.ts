import Prism, { Grammar } from "prismjs";
import chalk from "chalk";

export type ColorScheme = Record<string, string | null>;

export const defaultColorScheme = {
  punctuation: "#999",
  operator: "#9a6e3a",
  string: "#9a6e3a",
  keyword: "b#07a",
  "function-variable": null,
};

function chalkString(expr: string, str: string): string {
  if (expr.startsWith("b")) {
    return chalk.bold(chalkString(expr.substring(1), str));
  } else {
    return chalk.hex(expr)(str);
  }
}

/**
 * Highlights code with Prism and the applies Chalk to color
 * output for terminal
 * @param code
 */
export function chalkCode(code: string, lang: Grammar, colorScheme: ColorScheme = defaultColorScheme): string {
  return Prism.tokenize(code, Prism.languages.javascript)
    .map(element => {
      if (typeof element === "string") {
        return element;
      } else {
        let highlight = colorScheme[element.type];
        return highlight ? chalkString(highlight, element.content.toString()) : `${element.content}`;
      }
    })
    .join("");
}

chalkCode.typescript = (code: TemplateStringsArray | string, colorScheme: ColorScheme = defaultColorScheme) => {
  return chalkCode(typeof code === "string" ? code : code.join("\n"), Prism.languages.typescript, colorScheme);
};

chalkCode.json = (code: TemplateStringsArray | string, colorScheme: ColorScheme = defaultColorScheme) => {
  return chalkCode(typeof code === "string" ? code : code.join("\n"), Prism.languages.json, colorScheme);
};

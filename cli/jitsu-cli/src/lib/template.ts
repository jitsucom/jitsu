import path from "path";
import * as fs from "fs";
import { removeIndentation } from "./indent";

export type TemplateVars = Record<string, any>;
export type TemplateFunction<T> = (vars: T) => any;
export type FileTemplate<T> = TemplateFunction<T> | string | any;

export type ProjectTemplate<T extends TemplateVars = TemplateVars> = (vars: T) => Record<string, FileTemplate<T>>;

function toTemplateFunction<T>(template: FileTemplate<T>): TemplateFunction<T> {
  if (template === null || template === undefined) {
    return () => undefined;
  } else if (typeof template === "function") {
    return template;
  } else {
    return () => template;
  }
}

export function write<T extends TemplateVars = TemplateVars>(dir: string, template: ProjectTemplate<T>, vars: T) {
  Object.entries(template(vars)).forEach(([fileName, template]) => {
    let filePath = path.resolve(dir, fileName);
    let fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    let content = toTemplateFunction(template)(vars);
    if (typeof content === "object") {
      content = JSON.stringify(content, null, 2);
    }
    if (content) {
      let data = removeIndentation(content);
      fs.writeFileSync(filePath, data);
    }
  });
}

import { parse, type AnyNode } from "acorn";
import { simple } from "acorn-walk";
import { transform } from "esbuild";

// onResolve does not intercept esbuild's computed import/require globs. Check
// before bundling, so those globs never read local files. transform does no
// filesystem resolution and lowers syntax (e.g. decorators) that esbuild
// supports but Acorn doesn't. Callers must bundle this exact normalized code.
// Unknown runtime specifiers must also fail closed: their path is not knowable
// here. Literal specifiers still go through the existing import allowlist.
export async function validateAndNormalizeUdfCode(code: string): Promise<string> {
  const normalized = await transform(code, { loader: "js", target: "es2022", logLevel: "silent" });
  const ast = parse(normalized.code, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const check = (source: AnyNode | undefined) => {
    if (
      source &&
      ((source.type === "Literal" && typeof source.value === "string") ||
        (source.type === "TemplateLiteral" && source.expressions.length === 0))
    ) {
      return;
    }
    const location = source?.loc?.start;
    throw new Error(
      `Computed imports are not allowed in UDF functions. Use a literal module name${
        location ? ` (line ${location.line}, column ${location.column + 1})` : ""
      }.`
    );
  };
  simple(ast, {
    ImportExpression(node) {
      check(node.source);
    },
    CallExpression(node) {
      const callee = node.callee;
      const directRequire = callee.type === "Identifier" && callee.name === "require";
      // esbuild also treats module.require as a bundling import in CommonJS
      // source, including the equivalent module["require"] spelling.
      const moduleRequire =
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        callee.object.name === "module" &&
        ((!callee.computed && callee.property.type === "Identifier" && callee.property.name === "require") ||
          (callee.computed && callee.property.type === "Literal" && callee.property.value === "require") ||
          (callee.computed &&
            callee.property.type === "TemplateLiteral" &&
            callee.property.expressions.length === 0 &&
            callee.property.quasis[0].value.cooked === "require"));
      if (directRequire || moduleRequire) {
        check(node.arguments[0]);
      }
    },
  });
  return normalized.code;
}

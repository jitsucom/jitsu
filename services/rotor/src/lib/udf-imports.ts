import { parse, type AnyNode } from "acorn";
import { simple } from "acorn-walk";

// onResolve does not intercept esbuild's computed import/require globs. Check
// the original source before bundling, so those globs never read local files.
// Unknown runtime specifiers must also fail closed: their path is not knowable
// here. Literal specifiers still go through the existing import allowlist.
export function assertLiteralModuleSpecifiers(code: string): void {
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true });
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
      if (node.callee.type === "Identifier" && node.callee.name === "require") {
        check(node.arguments[0]);
      }
    },
  });
}

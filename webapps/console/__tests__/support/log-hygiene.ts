import ts from "typescript";

/**
 * JITSU-302: finds log calls that are handed a credential. Logs are copied to places with a wider audience than the code that
 * wrote them, so a token, a key, a cookie jar or a whole user object must never be an argument of a log call.
 *
 * A log call is `console.<level>(...)`, or `<logger>.at<Level>()[.withCause(..)].log(...)`. In its arguments, string text is
 * ignored (a message may say "token"); every other value is looked at: an identifier, the last name of a property access, a
 * shorthand property, the parts of a template. Values that cannot carry the secret (`!!token`, `typeof token`, `x.length`,
 * `Object.keys(x)`, `Boolean(x)`) are skipped.
 */
export type Finding = { line: number; name: string; call: string };

// names compared in lower case with underscores and dashes removed: idToken, id_token and ID-TOKEN are the same name
const DENIED = new Set(
  [
    "token",
    "tokens",
    "accessToken",
    "refreshToken",
    "idToken",
    "newToken",
    "secret",
    "secretKey",
    "password",
    "passwd",
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "sasl",
    "authorization",
    "processedParams",
    "userInfo",
    "apiKey",
    "privateKey",
    "csrfCookie",
    "csrfToken",
    "currentUser",
  ].map(n => n.toLowerCase())
);
const norm = (name: string) => name.toLowerCase().replace(/[_-]/g, "");

export function findSecretsInLogCalls(source: string, fileName = "file.ts", extraDenied: string[] = []): Finding[] {
  const denied = new Set([...DENIED, ...extraDenied.map(norm)]);
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings: Finding[] = [];

  const levelCallInChain = (e: ts.Expression): boolean => {
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const n = e.expression.name.text;
      if (/^at(Debug|Info|Warn|Error)$/.test(n)) return true;
      if (n === "withCause") return levelCallInChain(e.expression.expression);
    }
    return false;
  };
  const isLogCall = (node: ts.CallExpression): boolean => {
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const name = callee.name.text;
    if (ts.isIdentifier(callee.expression) && callee.expression.text === "console") {
      return ["log", "info", "warn", "error", "debug"].includes(name);
    }
    return name === "log" && levelCallInChain(callee.expression);
  };

  // a value that is only used to say whether or how much of something exists cannot leak it
  const isSafeWrapper = (n: ts.Node): boolean => {
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) return true;
    if (ts.isTypeOfExpression(n)) return true;
    if (ts.isPropertyAccessExpression(n) && ["length", "size"].includes(n.name.text)) return true;
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      return callee === "Boolean" || callee === "Object.keys";
    }
    return false;
  };

  const inspect = (n: ts.Node, out: string[]) => {
    if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n) || isSafeWrapper(n)) return;
    if (ts.isIdentifier(n)) {
      out.push(n.text);
      return;
    }
    if (ts.isPropertyAccessExpression(n)) {
      // the value is the last name of the chain: `req.cookies` is a cookie jar, `tokens.expires_in` is a number
      out.push(n.name.text);
      return;
    }
    if (ts.isElementAccessExpression(n)) {
      const index = n.argumentExpression;
      if (ts.isStringLiteralLike(index)) {
        // a literal index is a property name, like the name after a dot: `req.headers["authorization"]` is the
        // Authorization header and `tokens["expires_in"]` is a number
        out.push(index.text);
        return;
      }
      // a computed index: the object may be the secret (`cookies[name]`), and so may the index
      inspect(n.expression, out);
      inspect(index, out);
      return;
    }
    if (ts.isShorthandPropertyAssignment(n)) {
      out.push(n.name.text);
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      inspect(n.initializer, out);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      // `token ? "present" : "missing"` only tests the value: what the expression returns is what gets logged
      inspect(n.whenTrue, out);
      inspect(n.whenFalse, out);
      return;
    }
    ts.forEachChild(n, c => inspect(c, out));
  };

  // the arguments of every withCause(...) in the chain before the final .log(...): the logger prints the cause with its stack,
  // so `log.atError().withCause(new Error(token)).log("x")` logs the token
  const causeArguments = (e: ts.Expression): ts.Expression[] => {
    const out: ts.Expression[] = [];
    let current: ts.Expression = e;
    while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      if (current.expression.name.text === "withCause") out.push(...current.arguments);
      current = current.expression.expression;
    }
    return out;
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isLogCall(node)) {
      const names: string[] = [];
      node.arguments.forEach(a => inspect(a, names));
      if (ts.isPropertyAccessExpression(node.expression)) {
        causeArguments(node.expression.expression).forEach(a => inspect(a, names));
      }
      for (const name of names) {
        if (denied.has(norm(name))) {
          findings.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            name,
            call: node.getText(sf).replace(/\s+/g, " ").slice(0, 140),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

var generateBefore = function generateBefore(t, id) {
    return t.variableDeclaration('var', [t.variableDeclarator(id, t.callExpression(t.memberExpression(t.identifier('Date'), t.identifier('now')), []))]);
};

var generateInside = function generateInside() {
    var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
        t = _ref.t,
        id = _ref.id,
        line = _ref.line,
        ch = _ref.ch,
        timeout = _ref.timeout,
        extra = _ref.extra;

    return t.ifStatement(t.binaryExpression('>', t.binaryExpression('-', t.callExpression(t.memberExpression(t.identifier('Date'), t.identifier('now')), []), id), t.numericLiteral(timeout)), extra ? t.blockStatement([t.expressionStatement(t.callExpression(extra, [t.numericLiteral(line), t.numericLiteral(ch)])), t.breakStatement()]) : t.breakStatement());
};

var protect = function protect(t, timeout, extra) {
    return function (path) {
        if (!path.node.loc) {
            // I don't really know _how_ we get into this state
            // but https://jsbin.com/mipesawapi/1/ triggers it
            // and the node, I'm guessing after translation,
            // doesn't have a line in the code, so this blows up.
            return;
        }

        var id = path.scope.generateUidIdentifier('LP');
        var before = generateBefore(t, id);
        var inside = generateInside({
            t: t,
            id: id,
            line: path.node.loc.start.line,
            ch: path.node.loc.start.column,
            timeout: timeout,
            extra: extra
        });
        var body = path.get('body'); // if we have an expression statement, convert it to a block

        if (!t.isBlockStatement(body)) {
            body.replaceWith(t.blockStatement([body.node]));
        }

        path.insertBefore(before);
        body.unshiftContainer('body', inside);
    };
};

var protectPlugin = function () {
    var timeout = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 100;
    var extra = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

    if (typeof extra === 'string') {
        var string = extra;
        extra = "() => console.error(\"".concat(string.replace(/"/g, '\\"'), "\")");
    } else if (extra !== null) {
        extra = extra.toString();

        if (extra.startsWith('function (')) {
            // fix anonymous functions as they'll cause
            // the callback transform to blow up
            extra = extra.replace(/^function \(/, 'function callback(');
        }
    }

    return function (_ref2) {
        var t = _ref2.types,
            transform = _ref2.transform;
        var node = extra ? transform(extra, {
            ast: true
        }).ast.program.body[0] : null;
        var callback = null;

        if (t.isExpressionStatement(node)) {
            callback = node.expression;
        } else if (t.isFunctionDeclaration(node)) {
            callback = t.functionExpression(null, node.params, node.body);
        }

        return {
            visitor: {
                WhileStatement: protect(t, timeout, callback),
                ForStatement: protect(t, timeout, callback),
                DoWhileStatement: protect(t, timeout, callback)
            }
        };
    };
};
const callback = function callback(line) {
    throw new Error("Infinite(or too long) loop break on the line: " + line);
};

Babel.registerPlugin("loop-protect", protectPlugin(500, callback));
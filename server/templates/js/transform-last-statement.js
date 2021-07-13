"use strict";

var _excluded = ["key"];

function _extends() { _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }

function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }

// # babel-plugin-transform-last-statement
// ## The plugin itself

/**
 * Creates the plugin itself, grabbing what's needed from
 * the babel object set by Babel and the options passed by the configuration
 * @param {Object} babel
 * @param {Object} babel.types - The types
 * @param {Object} options
 * @param {boolean} [options.topLevel=false] - Whether to process the last statement of the program
 */
function transformLastStatement(types, topLevel) {
    var plugin = {
        visitor: {
            // Named functions (sync or async): `function template() {}`
            FunctionDeclaration: function FunctionDeclaration(path) {
                maybeInjectReturn(path.node.body, {
                    types: types.types,
                    scope: path.scope
                });
            },
            // Anonymous functions: `const a = function() {}`
            FunctionExpression: function FunctionExpression(path) {
                maybeInjectReturn(path.node.body, {
                    types: types.types,
                    scope: path.scope
                });
            },
            // Arrow functions: `() => {}`
            ArrowFunctionExpression: function ArrowFunctionExpression(path) {
                maybeInjectReturn(path.node.body, {
                    types: types.types,
                    scope: path.scope
                });
            },
            // Class methods
            // ```js
            // class aClass() {
            //   get property() {}
            //   set property(value) {}
            //   method() {}
            //   static staticMethod() {}
            // }
            // ```
            ClassMethod: function ClassMethod(path) {
                // Ignore constructors as there's no point injecting anything there
                // given their return value isn't actually returned to caller
                if (path.node.key.name !== 'constructor') {
                    maybeInjectReturn(path.node.body, {
                        types: types.types,
                        scope: path.scope
                    });
                }
            },
            // Object methods
            // ```js
            // {
            //   get property() {}
            //   set property(value) {}
            //   method() {}
            //   // key: function() {}
            //   // is a FunctionExpression
            // }
            // ```
            ObjectMethod: function ObjectMethod(path) {
                maybeInjectReturn(path.node.body, {
                    types: types.types,
                    scope: path.scope
                });
            }
        }
    };

    //if (topLevel) {
        plugin.visitor.Program = function Program(path) {
            maybeInjectReturn(path.node.body, {
                types: types.types,
                scope: path.scope
            });
        };
    //}

    return plugin;
}

; // ## AST Traversal
// Because we need to traverse the statements last to first
// we need a custom traversal.

/**
 * Traverse the given node or array of nodes recursively to look for
 * last statements to process.
 * @param {Object|Array} node - The node or array of nodes to traverse
 * @param {Object} options
 * @param {Object} scope - The Babel `scope`, used for generating new identifiers
 * @param {Object} types - The Babel `types`, used for creating new nodes
 * @param {String|number} [key] - An optional key to look into on the given node (can also be an array index)
 * @param {boolean} [replace=true] - Whether to do the replacement or not (so fallthrough `case`s can be supported)
 * @param {Object} [resultsIdentifier] - An Identifier node into which to `push` the last statements of loops instead of returning them
 * @returns {Boolean|Object|undefined} - Return a node to replace the currently processed value with, or `false` to stop processing other nodes in an array
 */

function maybeInjectReturn(node, _temp) {
    var _ref = _temp === void 0 ? {} : _temp,
        key = _ref.key,
        options = _objectWithoutPropertiesLoose(_ref, _excluded);

    // By default we want replacements to happen
    // unless a SwitchCase turns that off
    if (typeof options.replace === 'undefined') {
        options.replace = true;
    } // If provided a key, we're looking to inject return for
    // a specific key of the node


    if (typeof key !== 'undefined') {
        var updatedNode = maybeInjectReturn(node[key], options); // Replace the node if the node was transformed

        if (updatedNode) {
            node[key] = updatedNode;
        } // And halt the processing of current array


        if (typeof updatedNode !== 'undefined') {
            return false;
        }

        return;
    } // If provided an Array, we're looking to iterate over the nodes,
    // last to first.
    // IMPORTANT: This needs to be after the check for the key
    // to avoid infinite loop when calling


    if (Array.isArray(node)) {
        // For switches we want to only replace after we found a BreakStatement
        // We carry on the value for replacement
        var replace = options.afterBreak ? options.replace : true;

        for (var i = node.length; i--; i) {
            // And inject whichever value we found for our replacement
            var _updatedNode = maybeInjectReturn(node, _extends({
                key: i
            }, options, {
                replace: replace
            })); // Once we found a 'BreakStatement' we can start replacing


            if (node[i].type === 'BreakStatement') {
                replace = true;
            } // Stop iteracting as soon as we got something returned


            if (typeof _updatedNode !== 'undefined') {
                return false;
            }
        }

        return node;
    } // ### Traversal of individual statements


    switch (node.type) {
        // Main goal is to process expressions to return them
        case 'ExpressionStatement':
        {
            var types = options.types,
                _replace = options.replace,
                resultsIdentifier = options.resultsIdentifier; // First we need to check if we're actually allowed
            // to replace, in case we're in a `switch`.
            // Note that the actuall expression to return is
            // the `node.expression`, not the `ExpressionStatement` itself

            if (_replace) {
                var statement; // Now we need to process things slightly differently
                // whether we're inside a loop or not, marked by the
                // presence of a `resultsIdentifier` for the Array
                // in which to `push` the results of the loop

                if (resultsIdentifier) {
                    // A bit of a mouthfull to write `<IdentifierName>.push(<NodeExpression>)`
                    statement = types.ExpressionStatement(types.CallExpression(types.MemberExpression(resultsIdentifier, types.Identifier('push')), [node.expression]));
                } else {
                    // In all other cases, we wrap the expression with a return
                    statement = types.ReturnStatement(node.expression);
                } // And make sure comments end up on the wrapping node


                moveComments(node, statement);
                return statement;
            }

            return;
        }
        // If we find a return or throw, we skip
        // Same with `debugger;` and `continue` statements,
        // which shouldn't be short-circuited by an early return

        case 'ReturnStatement':
        case 'ThrowStatement':
        case 'DebuggerStatement':
        case 'ContinueStatement':
        {
            return false;
        }
        // `if` statements need both their branches visited

        case 'IfStatement':
        {
            maybeInjectReturn(node, _extends({
                key: 'consequent'
            }, options));

            if (node.alternate) {
                maybeInjectReturn(node, _extends({
                    key: 'alternate'
                }, options));
            } // Either we'll have injected returns as needed
            // or there will have been some returns already
            // so we can stop there


            return false;
        }
        // `with` blocks only have one body
        // and so do labeledstatements `label: const a = 5;`

        case 'LabeledStatement':
        case 'WithStatement':
        {
            return maybeInjectReturn(node, _extends({
                key: 'body'
            }, options));
        }
        // We only want to mess with the `try` block
        // `catch` might yield unexpected values being returned
        // so best leave to an explicit return
        // `finally` is even worse: it would return before the `try`
        // so a definite no go:
        // https://eslint.org/docs/rules/no-unsafe-finally

        case 'TryStatement':
        {
            maybeInjectReturn(node, _extends({
                key: 'block'
            }, options));
            return false;
        }
        // Blocks will have multiple statements in their body,
        // we'll need to traverse them last to first

        case 'BlockStatement':
        {
            var update = maybeInjectReturn(node, _extends({
                key: 'body'
            }, options));

            if (typeof update !== 'undefined') {
                return false;
            }

            return;
        }
        // `switch` statements need their own processing
        // - each case/default statement can either host a block or an array of statements
        // - we should only inject returns after we found a "break" in `case` statements.
        //   The following `case`/`default` gets run
        //   if there is no `break` and adding a return would prevent that.
        //   While it's recommended not to fallthrough (https://eslint.org/docs/rules/no-fallthrough)
        //   there are some valid use cases, so we need to handle it

        case 'SwitchStatement':
        {
            node.cases.forEach(function (switchCase) {
                maybeInjectReturn(switchCase, _extends({}, options, {
                    key: 'consequent',
                    afterBreak: !!switchCase.test,
                    // Only replace if a break exists for `case`, not `default`
                    replace: false
                }));
            });
            return false;
        }
        // Loops need their own processing too. We need to aggregate their data
        // in an array and then return that array

        case 'ForStatement':
        case 'DoWhileStatement':
        case 'WhileStatement':
        case 'ForInStatement':
        case 'ForOfStatement':
        {
            return wrapLoopNode(node, options);
        }
        // Class declarations need to be turned into ClassExpressions
        // That can be returned as a regular expression

        case 'ClassDeclaration':
        {
            node.type = 'ClassExpression'; // We still need to handle it like a regular expression
            // at that point, so let's go for another round

            var expressionStatement = options.types.ExpressionStatement(node);
            moveComments(node, expressionStatement);
            return maybeInjectReturn(expressionStatement, options);
        }
    }
} // ## Supporting functions

/**
 * @param {Object} fromNode
 * @param {Object} toNode
 */


function moveComments(fromNode, toNode) {
    toNode.leadingComments = fromNode.leadingComments;
    toNode.trailingComments = fromNode.trailingComments;
    fromNode.leadingComments = null;
    fromNode.trailingComments = null;
} // We need to add a variable declaration before loops,
// and then return that variable. Quite a block to have
// in the main traversal, so it's in its own function instead.

/**
 * @param {Object} node - The loop node
 * @param {Object} options
 * @param {Object} options.types
 * @param {Object} options.scope
 * @param {Object} options.resultsIdentifier
 */


function wrapLoopNode(node, options) {
    var types = options.types,
        scope = options.scope; // A parent loop might have already created a variable
    // to push into, so we only create on if needed

    var identifier = options.resultsIdentifier || scope.generateUidIdentifier('result'); // Then we can process the content of the loop

    maybeInjectReturn(node, _extends({}, options, {
        key: 'body',
        resultsIdentifier: identifier
    })); // And finally wrap it only if we created the identifiers beforehand

    if (options.resultsIdentifier) {
        // Just like the other blocks, we consider that either
        // we'll have added a return, or there was one (or a `continue`) already
        // so we stop traversing siblings
        return false;
    } else {
        // We don't have access to `replaceWithMultiple` as we need
        // our own traversal so we replace the for with our own block
        // of commands
        return types.BlockStatement([// Using `var` allows terser (maybe other minifiers too) to eliminate the block we just created
            // if it is unnecessary. With `const` or `let`, the variable would be
            // scoped to the block, so terser wouldn't be able to know if it's safe
            // to eliminate the block or not
            types.VariableDeclaration('var', [types.VariableDeclarator(identifier, types.ArrayExpression())]), node, types.ReturnStatement(identifier)]);
    }
} // Little utility for outputing the name of a node
// cleanly (that is without dumping a whole object
// in the console)
// eslint-disable-next-line no-unused-vars


function nodeDebugName(node) {
    if (typeof node === 'undefined') return 'undefined';

    if (Array.isArray(node)) {
        return 'Array';
    }

    return node && node.type || node;
}

Babel.registerPlugin("transform-last-statement", transformLastStatement);
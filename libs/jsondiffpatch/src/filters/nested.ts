import DiffContext from "../contexts/diff.js";
import PatchContext from "../contexts/patch.js";
import type { ArrayDelta, Delta, Filter, ObjectDelta } from "../types.js";

export const collectChildrenDiffFilter: Filter<DiffContext> = context => {
  if (!context || !context.children) {
    return;
  }
  const length = context.children.length;
  let child;
  let result = context.result as ObjectDelta | ArrayDelta;
  for (let index = 0; index < length; index++) {
    child = context.children[index];
    if (typeof child.result === "undefined") {
      continue;
    }
    result = result || {};
    (result as Record<string | number, Delta>)[child.childName!] = child.result;
  }
  if (result && context.leftIsArray) {
    result._t = "a";
  }
  context.setResult(result).exit();
};
collectChildrenDiffFilter.filterName = "collectChildren";

export const objectsDiffFilter: Filter<DiffContext> = context => {
  if (context.leftIsArray || context.leftType !== "object") {
    return;
  }

  const left = context.left as Record<string, unknown>;
  const right = context.right as Record<string, unknown>;

  let name;
  let child;
  const propertyFilter = context.options!.propertyFilter;
  for (name in left) {
    if (!Object.prototype.hasOwnProperty.call(left, name)) {
      continue;
    }
    if (propertyFilter && !propertyFilter(name, context)) {
      continue;
    }
    child = new DiffContext(left[name], right[name]);
    context.push(child, name);
  }
  for (name in right) {
    if (!Object.prototype.hasOwnProperty.call(right, name)) {
      continue;
    }
    if (propertyFilter && !propertyFilter(name, context)) {
      continue;
    }
    if (typeof left[name] === "undefined") {
      child = new DiffContext(undefined, right[name]);
      context.push(child, name);
    }
  }

  if (!context.children || context.children.length === 0) {
    context.setResult(undefined).exit();
    return;
  }
  context.exit();
};
objectsDiffFilter.filterName = "objects";

export const patchFilter: Filter<PatchContext> = function nestedPatchFilter(context) {
  if (!context.nested) {
    return;
  }
  const nestedDelta = context.delta as ObjectDelta | ArrayDelta;
  if (nestedDelta._t) {
    return;
  }
  const objectDelta = nestedDelta as ObjectDelta;
  let name;
  let child;
  for (name in objectDelta) {
    child = new PatchContext((context.left as Record<string, unknown>)[name], objectDelta[name]);
    context.push(child, name);
  }
  context.exit();
};
patchFilter.filterName = "objects";

export const collectChildrenPatchFilter: Filter<PatchContext> = function collectChildrenPatchFilter(context) {
  if (!context || !context.children) {
    return;
  }
  const deltaWithChildren = context.delta as ObjectDelta | ArrayDelta;
  if (deltaWithChildren._t) {
    return;
  }
  const object = context.left as Record<string, unknown>;
  const length = context.children.length;
  let child;
  for (let index = 0; index < length; index++) {
    child = context.children[index];
    const property = child.childName as string;
    if (Object.prototype.hasOwnProperty.call(context.left, property) && child.result === undefined) {
      delete object[property];
    } else if (object[property] !== child.result) {
      object[property] = child.result;
    }
  }
  context.setResult(object).exit();
};
collectChildrenPatchFilter.filterName = "collectChildren";

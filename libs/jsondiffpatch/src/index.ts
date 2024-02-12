import DiffPatcher from "./diffpatcher.js";
import type { Delta, Options } from "./types.js";
import type Context from "./contexts/context.js";
import type DiffContext from "./contexts/diff.js";
import type PatchContext from "./contexts/patch.js";

export { DiffPatcher };

export type * from "./types.js";
export type { Context, DiffContext, PatchContext };

export function create(options?: Options) {
  return new DiffPatcher(options);
}

let defaultInstance: DiffPatcher;

export function diff(left: unknown, right: unknown) {
  if (!defaultInstance) {
    defaultInstance = new DiffPatcher();
  }
  return defaultInstance.diff(left, right);
}

export function patch(left: unknown, delta: Delta) {
  if (!defaultInstance) {
    defaultInstance = new DiffPatcher();
  }
  return defaultInstance.patch(left, delta);
}

import type Context from "./contexts/context.js";
import type DiffContext from "./contexts/diff.js";

export interface Options {
  objectHash?: (item: object, index?: number) => string | undefined;
  matchByPosition?: boolean;
  arrays?: {
    detectMove?: boolean;
    includeValueOnMove?: boolean;
  };
  propertyFilter?: (name: string, context: DiffContext) => boolean;
}

export type AddedDelta = [unknown];
export type ModifiedDelta = [unknown, unknown];
export type DeletedDelta = [unknown, 0, 0];

export interface ObjectDelta {
  [property: string]: Delta;
}

export interface ArrayDelta {
  _t: "a";
  [index: number | `${number}`]: Delta;
  [index: `_${number}`]: DeletedDelta | MovedDelta;
}

export type MovedDelta = [unknown, number, 3];

export type TextDiffDelta = [string, 0, 2];

export type Delta =
  | AddedDelta
  | ModifiedDelta
  | DeletedDelta
  | ObjectDelta
  | ArrayDelta
  | MovedDelta
  | TextDiffDelta
  | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Filter<TContext extends Context<any>> {
  (context: TContext): void;
  filterName: string;
}

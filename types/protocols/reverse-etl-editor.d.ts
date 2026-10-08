import type { ZodType } from "zod";

/** Browser-safe, provider-owned form descriptions. Values remain user intent until runtime resolution. */
export interface ReverseEditorOptions {
  mode: "upsert" | "mirror";
  mapping: Record<string, string>;
  streamOptions: Record<string, any>;
}
export type ReverseEditorPatch = Partial<ReverseEditorOptions>;
interface FieldBase {
  key?: string;
  name?: string;
  documentation?: string;
  group?: string;
}
export type ReverseEditorField<Key extends string = string> = FieldBase &
  (
    | { editor: "text"; value: string; change(value: string): ReverseEditorPatch }
    | {
        editor: "target";
        value: string;
        targetKind: string;
        lookupParams?: Record<string, string>;
        change(value: string): ReverseEditorPatch;
      }
    | {
        editor: "select";
        value?: string;
        choices: { value: string; label: string }[];
        change(value: string): ReverseEditorPatch;
      }
    | { editor: "number"; value: number; min?: number; max?: number; change(value: number | null): ReverseEditorPatch }
    | { editor: "checkbox"; value: boolean; label: string; change(value: boolean): ReverseEditorPatch }
    | { editor: "notice"; title: string; description: string; showIcon?: boolean }
    | { editor: "mapping"; field: Key }
    | { editor: "identifier"; raw: Key; hashed: Key }
    /** Read-only list of the model's columns with a payload preview; writes the identity mapping (each column to itself). */
    | { editor: "columns" }
  );
export interface ReverseStreamEditor {
  id: string;
  label: string;
  settings: ZodType<any>;
  /** Default for the sync's `checkpointEvery` when this stream is chosen; omitted means the platform default. */
  checkpointEvery?: number;
  defaults(): ReverseEditorOptions;
  fields(options: ReverseEditorOptions): ReverseEditorField[];
}

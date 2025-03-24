/**
 * UI for property
 */
export type PropertyUI = {
  /**
   * Optional human-friendly name of the field
   */
  displayName?: string;
  /**
   * If string field should be treated as textarea (multiline input)
   */
  textarea?: boolean;
  /**
   * If string field should be treated as password
   */
  password?: boolean;
  /**
   * If the field should not be displayed. That field must have a default value
   */
  hidden?: boolean | ((obj: any) => boolean);
  /**
   * If the field should be a constant
   */
  constant?: any | ((obj: any) => any);
  /**
   * correction to field value. e.g: set default value for property that was missing before
   */
  correction?: any | ((obj: any) => any);

  /**
   * Documentation for the field
   */
  documentation?: string;
  /**
   * Name of custom editor component. See getEditorComponent() function from `[workspaceId]/destinations.txt`
   */
  editor?:
    | "ArrayTextarea"
    | "StringArrayEditor"
    | "CodeEditor"
    | "SnippedEditor"
    | "MultiSelectWithCustomOptions"
    | string;
  /**
   * Properties of an editor component (not implemented yet, reserved for the future)
   */
  editorProps?: any;
};

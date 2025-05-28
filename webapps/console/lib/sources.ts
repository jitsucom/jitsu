import { SelectedStreamSettings } from "./schema";

export const initStream = (stream: any, mode?: "full_refresh" | "incremental"): SelectedStreamSettings => {
  const supportedModes = stream.supported_sync_modes;
  let sync_mode: "full_refresh" | "incremental" = "full_refresh";
  let cursor_field: string[] | undefined = undefined;
  if (supportedModes.includes("incremental") && mode !== "full_refresh") {
    if (stream.source_defined_cursor) {
      sync_mode = "incremental";
    }
    if (stream.default_cursor_field?.length > 0) {
      sync_mode = "incremental";
      cursor_field = stream.default_cursor_field;
    } else {
      const props = Object.entries(stream.json_schema.properties as Record<string, any>);
      const dateProps = props.filter(([_, p]) => p.format === "date-time");
      const cursorField =
        dateProps.find(([name, _]) => name.startsWith("updated")) ||
        dateProps.find(([name, _]) => name.startsWith("created")) ||
        dateProps.find(([name, _]) => name === "timestamp") ||
        props.find(
          ([name, p]) =>
            name === "id" && (p.type === "integer" || (Array.isArray(p.type) && p.type.includes("integer")))
        );
      if (cursorField) {
        sync_mode = "incremental";
        cursor_field = [cursorField[0]];
      }
    }
  }
  return {
    sync_mode,
    cursor_field,
  };
};

export function idToSnakeCaseRegex(id: string) {
  return id.replace(/((?<=[a-zA-Z0-9])[A-Z])/g, "_$1").toLowerCase();
}

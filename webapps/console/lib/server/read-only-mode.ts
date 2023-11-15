import { getLog } from "juava";

export const isReadOnly = !!process.env.JITSU_CONSOLE_READ_ONLY_UNTIL;

export const readOnlyUntil = getReadOnlyUntil();

function getReadOnlyUntil(): Date | undefined {
  if (!isReadOnly) {
    return undefined;
  }
  let readOnlyUntil;
  try {
    readOnlyUntil = new Date(process.env.JITSU_CONSOLE_READ_ONLY_UNTIL!);
  } catch (e) {
    getLog()
      .atWarn()
      .log(
        `Read only until is not a valid date: ${process.env.JITSU_CONSOLE_READ_ONLY_UNTIL}. Setting a date 2 hours from now`
      );
    readOnlyUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
  }
  getLog().atInfo().log(`Read only mode enabled until: ${readOnlyUntil}`);
  return readOnlyUntil;
}

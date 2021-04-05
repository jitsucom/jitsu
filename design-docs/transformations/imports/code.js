/**
 * Just code with transformation logic. Useful for inlining.
 *
 * export function transform(event) {
 *   <code>
 *   let result = event.__jitsu_table__ !== undefined ? [event.__jitsu_table__, event] : event;
 *   delete event.__jitsu_table__;
 *   return result
 * }
 */
event.x = 1;
event.__jitsu_table__ = "x";


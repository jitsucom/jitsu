/**
 * A simple JS file which contains function transform which is not exported.
 * Result is object or null
 */

function transform(event) {
  return event.a === "1" ? {...event, addField: "x"} : null;
}
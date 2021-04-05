/**
 * 1) Function is exported as default.
 * 2) The transformation returns the object. The result should be transformed to to [DEFAULT_TABLE_NAME, event]
 */
export default function(event) {
  return {a: event.b || null};
}
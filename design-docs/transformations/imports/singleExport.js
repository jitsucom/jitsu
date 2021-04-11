/**
 * Main case when package exports one function called transform
 */

export function transform(event) {
  return {...event, add: 1};
}
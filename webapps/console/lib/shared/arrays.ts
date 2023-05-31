export function arrayToMap(arr: any[]): any {
  if (!arr || arr.length === 0) {
    return {};
  }
  return arr.reduce((acc, entity) => {
    acc[entity.id] = entity;
    return acc;
  }, {});
}

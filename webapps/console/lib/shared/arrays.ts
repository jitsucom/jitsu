export function arrayToMap<T extends {id: string} = {id: string} & Record<string, any>>(arr: T[]): Record<string, T> {
  if (!arr || arr.length === 0) {
    return {};
  }
  return arr.reduce((acc, entity) => {
    acc[entity.id] = entity;
    return acc;
  }, {});
}

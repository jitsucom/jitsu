import { naturalSort } from '@util/Array';

const getUniqueAutoIncId = (base: string, exists: string[]) => {
  if (!exists.includes(base)) {
    return base;
  }

  const existsBase = naturalSort(exists.filter(e => e.startsWith(base) && !isNaN(Number(e.replace(base, '')))));

  let baseTail = Number(existsBase[existsBase.length - 1].replace(base, '')) + 1;

  return `${base}${baseTail}`;
};

export { getUniqueAutoIncId };

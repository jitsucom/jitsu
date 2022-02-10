import { naturalSort } from "./arrays"

function randomId(len?: number) {
  const str = Math.random().toString(36).substring(2, len) + Math.random().toString(36).substring(2, 15)
  return len ? str.substr(0, len) : str
}

function getUniqueAutoIncId(base: string, exists: string[]) {
  if (!exists.includes(base)) {
    return base
  }

  const existsBase = naturalSort(exists.filter(e => e.startsWith(base) && !isNaN(Number(e.replace(base, "")))))

  const baseTail = Number(existsBase[existsBase.length - 1].replace(base, "")) + 1

  return `${base}${baseTail}`
}

export { randomId, getUniqueAutoIncId }

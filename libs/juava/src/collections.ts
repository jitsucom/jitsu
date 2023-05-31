export type Indexer<T, K extends keyof any = string> = ((t: T) => K) | keyof T;

export function index<T, K extends keyof any = string>(array: T[], indexer: Indexer<T, K>): Record<K, T> {
  const indexerF = typeof indexer === "function" ? indexer : (t: T) => t[indexer] as any;
  return array.reduce((acc, t) => {
    acc[indexerF(t)] = t;
    return acc;
  }, {} as Record<K, T>);
}

export function transformKeys<VSrc, VDst, K extends keyof any = string>(
  map: Record<K, VSrc>,
  transformer: (t: VSrc) => VDst
): Record<K, VDst> {
  return Object.keys(map).reduce((acc, k) => {
    acc[k] = transformer(map[k]);
    return acc;
  }, {} as Record<K, VDst>);
}

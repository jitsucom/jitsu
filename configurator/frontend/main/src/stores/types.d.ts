/**
 * Common methods of all global stores
 *
 *
 * ℹ️ About generators:
 * MobX Actions can be implemented in a few ways but the least verbose one is using
 * generators (so called Flows). The only downside of using generators is the return
 * value that may seem too scary. But there is a rescue -- just convert the return
 * value of action using `flowResult` to turn it into a Promise like the following:
 *
 * @example
 * import { flowResult } from "mobx"
 * //...
 * const result = await flowResult(someStore.add(entity))
 */
interface EntitiesStore<T> {
  add(entity: T): Generator<Promise<unknown>, void, unknown>
  delete(entity: T): Generator<Promise<unknown>, void, unknown>
  update(entities: T | Array<T>, options?: UnknownObject): Generator<Promise<unknown>, void, unknown>
  get(id: string): T
  list: Array<T>
}

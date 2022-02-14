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
  add(entityOrOptions: T | { [key: string]: string }): Generator<Promise<unknown>, void, unknown>
  delete(id: string): Generator<Promise<unknown>, void, unknown>
  replace(entity: T, options?: EntityUpdateOptions): Generator<Promise<unknown>, void, unknown>
  patch(id: string, patch: Partial<T>, options?: EntityUpdateOptions): Generator<Promise<unknown>, void, unknown>
  get(id: string): T
  list: Array<T>
}

type EntityUpdateOptions = {
  /**
   * Whether to update connections between entities, e.g. `apiKey <--> destinations`, `source <--> destinations` etc.
   *
   * Set to `true` by default but you may want to set it to `false` when it causes infinite update loops,
   * e.g when updating destinations when deleted a source pass `updateConnections: false` to destinations `patch()`
   * method, otherwise it will try to update sources in turn.
   */
  updateConnections?: boolean
}

declare interface Option {
  id: string | number
  displayName: string
}

// @Types
declare type Optional<T> = T | null | undefined

// @Functions
declare type GenericFunction<A, R> = (...args: A) => R | Promise<R>
declare type VoidFunction = () => void
declare type UnknownArgsVoidFunction = (args: unknown) => void
declare type UnknownFunction = () => unknown
declare type AsyncVoidFunction = () => Promise<void>
declare type AsyncUnknownFunction = () => Promise<unknown>
declare type NotFunction<T> = T extends Function ? never : T

// @Objects
declare interface AnyObject {
  [key: string]: any
}
declare type UnknownObject = {
  [key: string]: unknown | UnknownObject
}
declare type PlainObjectWithPrimitiveValues = {
  [key: string]: string | number | boolean
}
declare type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>
}

// @React

declare type ReactSetState<T> = React.Dispatch<React.SetStateAction<T>>

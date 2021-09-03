declare interface Option {
  id: string | number;
  displayName: string;
}

declare type GenericFunction<A, R> = (...args: A) => R | Promise<R>;
declare type VoidFunction = () => void;
declare type AsyncVoidFunction = () => Promise<void>;

declare type NotFunction<T> = T extends Function ? never : T;

declare interface AnyObject {
  [key: string]: any;
}

declare type UnknownObject = {
  [key: string]: unknown;
};

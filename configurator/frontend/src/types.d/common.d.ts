declare interface Option {
  id: string | number;
  displayName: string;
}

declare type VoidFunc = (...args: any) => void;
declare type AsyncVoidFunction = () => Promise<void>;

declare interface AnyObject {
  [key: string]: any;
}

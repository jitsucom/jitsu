declare interface Option {
  id: string | number;
  displayName: string;
}

declare type VoidFunc = (...args: any) => void;

declare interface AnyObject {
  [key: string]: any;
}

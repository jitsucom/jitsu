declare interface Option {
  id: string | number;
  displayName: string;
}

declare type VoidFunction = () => void;
declare type AsyncVoidFunction = () => Promise<void>;

declare interface AnyObject {
  [key: string]: any;
}

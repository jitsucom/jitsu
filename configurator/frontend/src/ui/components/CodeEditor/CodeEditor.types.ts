export interface Props {
  handleChange: (value: string) => void;
  initialValue?: object | string;
  height?: number;
  language?: string;
  dynamicHeight?: () => number;
}

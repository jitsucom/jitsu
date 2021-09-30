export interface Props {
  initialValue?: object | string;
  className?: string;
  height?: number;
  language?: string;
  dynamicHeight?: () => number;
  handleChange: (value: string) => void;
}

import MonacoEditor from 'react-monaco-editor';

export interface Props {
  handleChange: (value: string) => void;
  initialValue?: object | string;
  height?: number;
  monacoRef?: { current: MonacoEditor };
  language?: string;
}

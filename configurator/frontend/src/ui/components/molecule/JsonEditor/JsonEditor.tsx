import * as monacoEditor from 'monaco-editor';
import MonacoEditor from 'react-monaco-editor';

monacoEditor.editor.defineTheme('own-theme', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    {
      foreground: '75715e',
      token: 'comment'
    }
  ],
  colors: {
    'editor.foreground': '#F8F8F2',
    'editor.background': '#111827',
    'editor.selectionBackground': '#49483E',
    'editor.lineHighlightBackground': '#111827',
    'editorCursor.foreground': '#F8F8F0',
    'editorWhitespace.foreground': '#3B3A32',
    'editorIndentGuide.activeBackground': '#9D550FB0',
    'editor.selectionHighlightBorder': '#222218'
  }
});

interface Props {
  handleChange: (value: string) => void;
  initialValue: object | string;
}

const JsonEditor = ({ handleChange: handleChangeProp, initialValue }: Props) => {
  const value = !initialValue
    ? ''
    : typeof initialValue === 'string'
      ? initialValue
      : JSON.stringify(initialValue);

  const handleChange = (value: string) => handleChangeProp(value);

  return (
    <MonacoEditor
      height="300"
      language="json"
      theme="own-theme"
      onChange={handleChange}
      value={value}
      options={{
        glyphMargin: false,
        folding: false,
        lineNumbers: 'off',
        lineDecorationsWidth: 11,
        lineNumbersMinChars: 0,
        minimap: {
          enabled: false
        },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8
        },
        padding: {
          top: 4,
          bottom: 4
        },
        hideCursorInOverviewRuler: true,
        overviewRulerLanes: 0
      }}
    />
  )
};

JsonEditor.displayName = 'JsonEditor';

export { JsonEditor };

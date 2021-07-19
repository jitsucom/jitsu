import { useEffect, useRef } from 'react';
import * as monacoEditor from 'monaco-editor';
import MonacoEditor from 'react-monaco-editor';
import { Props } from './CodeEditor.types';
import { IKeyboardEvent } from 'monaco-editor';

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

const CodeEditorComponent = ({
  handleChange: handleChangeProp,
  initialValue,
  language = 'json'
}: Props) => {
  const defaultValue = !initialValue
    ? ''
    : typeof initialValue === 'string'
    ? initialValue
    : JSON.stringify(initialValue);

  const handleChange = (e: IKeyboardEvent) => {
    const model = ref.current.editor.getModel();
    const value = model.getValue();

    handleChangeProp(value);
  };

  const ref = useRef<MonacoEditor>();

  useEffect(() => {
    if (ref.current?.editor) {
      if (initialValue) {
        const model = ref.current.editor.getModel();

        model.setValue(defaultValue);
      }

      ref.current.editor.onKeyUp(handleChange);
    }
  }, [initialValue]);

  return (
    <MonacoEditor
      ref={ref}
      language={language}
      theme="own-theme"
      defaultValue={defaultValue}
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
  );
};

CodeEditorComponent.displayName = 'CodeEditor';

export default CodeEditorComponent;

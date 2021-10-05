import { memo, useEffect, useRef } from 'react';
import * as monacoEditor from 'monaco-editor';
import MonacoEditor from 'react-monaco-editor';
import { Props } from './CodeEditor.types';
import { IKeyboardEvent } from 'monaco-editor';
import isEqual from 'lodash/isEqual';

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
  initialValue,
  className,
  language = 'json',
  enableLineNumbers,
  reRenderEditorOnInitialValueChange = true,
  handleChange: handleChangeProp,
  hotkeysOverrides
}: Props) => {
  const defaultValue = !initialValue
    ? ''
    : typeof initialValue === 'string'
    ? initialValue
    : JSON.stringify(initialValue);

  const handleChange = (e: IKeyboardEvent) => {
    const model = ref.current.editor.getModel();
    const value = model.getValue();

    if (e.metaKey || e.altKey) return; // excludes the hotkeys

    handleChangeProp(value);
  };

  const ref = useRef<MonacoEditor>();

  useEffect(() => {
    if (ref.current?.editor) {
      if (initialValue && reRenderEditorOnInitialValueChange) {
        const model = ref.current.editor.getModel();
        model.setValue(defaultValue);
      }
    }
  }, [initialValue, reRenderEditorOnInitialValueChange]);

  useEffect(() => {
    ref.current?.editor?.onKeyUp(handleChange);
  }, []);

  useEffect(() => {
    const { onCmdCtrlEnter, onCmdCtrlU, onCmdCtrlI } = hotkeysOverrides ?? {};
    onCmdCtrlEnter &&
      ref.current?.editor.addAction({
        id: 'cmd-enter-shortcut',
        label: 'cmd/ctrl + enter',
        keybindings: [monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.Enter],
        run: onCmdCtrlEnter
      });
    onCmdCtrlI &&
      ref.current?.editor.addAction({
        id: 'cmd-i-shortcut',
        label: 'cmd/ctrl + I',
        keybindings: [monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.KEY_I],
        run: onCmdCtrlI
      });
    onCmdCtrlU &&
      ref.current?.editor.addAction({
        id: 'cmd-u-shortcut',
        label: 'cmd/ctrl + U',
        keybindings: [monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.KEY_U],
        run: onCmdCtrlU
      });
  }, []);

  return (
    <MonacoEditor
      ref={ref}
      className={className}
      language={language}
      theme="own-theme"
      defaultValue={defaultValue}
      options={{
        automaticLayout: true,
        glyphMargin: false,
        folding: false,
        lineNumbers: enableLineNumbers ? 'on' : 'off',
        lineDecorationsWidth: 11,
        lineNumbersMinChars: 0,
        minimap: {
          enabled: false
        },
        scrollbar: {
          verticalScrollbarSize: 5,
          horizontalScrollbarSize: 5
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

export default memo(CodeEditorComponent, isEqual);

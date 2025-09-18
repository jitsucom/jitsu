import Editor from "@monaco-editor/react";
import React, { ReactNode, useCallback, useEffect, useRef } from "react";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import debounce from "lodash/debounce";
import * as monaco from "monaco-editor";
import styles from "./CodeEditor.module.css";

type CodeEditorProps = {
  value: string;
  language: string;
  height?: string;
  width?: string;
  onChange: (value: string) => void;
  changePosition?: (position: number) => void;
  ctrlEnterCallback?: (value: string) => void;
  ctrlSCallback?: (value: string) => void;
  foldLevel?: number;
  extraSuggestions?: string;
  loaderNode?: ReactNode;
  autoFit?: boolean;
  monacoOptions?: Partial<monaco.editor.IStandaloneEditorConstructionOptions>;
  syntaxCheck?: {
    json?: boolean;
  };
};

export const CodeEditor: React.FC<CodeEditorProps> = ({
  language,
  height,
  width,
  onChange,
  value,
  ctrlEnterCallback,
  ctrlSCallback,
  changePosition,
  monacoOptions,
  extraSuggestions,
  foldLevel,
  loaderNode,
  autoFit,
  syntaxCheck,
}) => {
  const editorRef = useRef<any>(null);
  const [mounted, setMounted] = React.useState(false);
  const handleChange = onChange;
  const handleChangePosition = changePosition ? debounce(changePosition, 100) : undefined;

  const handleEditorDidMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      if (typeof value !== "undefined") {
        editor.setValue(value);
      }
      if (foldLevel) {
        editor.getAction(`editor.foldLevel${foldLevel}`)?.run();
      }
      if (extraSuggestions) {
        monaco.languages.typescript.javascriptDefaults.setExtraLibs([{ content: extraSuggestions }]);
      }
      if (syntaxCheck && typeof syntaxCheck.json !== "undefined") {
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          validate: syntaxCheck.json,
        });
      }
      if (handleChangePosition) {
        editor.onDidChangeCursorPosition(e => {
          handleChangePosition?.(editor.getModel().getOffsetAt(e.position));
        });
      }
      if (autoFit) {
        editor.layout({
          width: 200,
          height: Math.max(editor.getContentHeight(), 50),
        });
      }
      setMounted(true);
    },
    [autoFit, extraSuggestions, foldLevel, handleChangePosition, syntaxCheck, value]
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      const onKeyDown = editor.onKeyDown(e => {
        if (e.ctrlKey || e.metaKey) {
          if (ctrlEnterCallback && e.code === "Enter") {
            ctrlEnterCallback(editor.getValue());
            e.preventDefault();
            e.stopPropagation();
          } else if (ctrlSCallback && e.code === "KeyS") {
            ctrlSCallback(editor.getValue());
            e.preventDefault();
            e.stopPropagation();
          }
        }
      });
      return () => {
        onKeyDown.dispose();
      };
    }
  }, [ctrlEnterCallback, ctrlSCallback, mounted]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      const positionShift = value.length - editor.getValue().length;
      if (Math.abs(positionShift) > 2 || monacoOptions?.readOnly) {
        // we respect prop.value change only if it's more than 2 characters
        // otherwise, it's probably user is typing, and we don't want to rollback what he typed due to delay in props update
        const position = editor.getPosition();
        editor.setValue(value);
        editor.setPosition({ ...position, column: position.column + positionShift });
        //scroll to the end of the line
        editor.revealPosition({ ...position, column: position.column + positionShift + 100 });
        editor.focus();
        if (foldLevel) {
          editor.getAction(`editor.foldLevel${foldLevel}`)?.run();
        }
      }
    }
  }, [value, foldLevel, monacoOptions?.readOnly]);

  return (
    <div className="w-full h-full">
      <Editor
        onChange={v => {
          handleChange(v || "");
        }}
        loading={loaderNode || <LoadingAnimation />}
        language={language}
        height={height}
        width={width}
        onMount={handleEditorDidMount}
        className={styles.editor}
        options={{
          fixedOverflowWidgets: true,
          automaticLayout: true,
          glyphMargin: false,
          scrollBeyondLastLine: false,
          folding: false,
          lineNumbers: "on",
          renderLineHighlight: "none",
          lineDecorationsWidth: 16,
          lineNumbersMinChars: 2,
          minimap: {
            enabled: false,
          },
          scrollbar: {
            verticalScrollbarSize: 5,
            horizontalScrollbarSize: 5,
          },
          padding: {
            top: 8,
            bottom: 4,
          },
          hideCursorInOverviewRuler: true,
          overviewRulerLanes: 0,
          ...monacoOptions,
        }}
      />
    </div>
  );
};

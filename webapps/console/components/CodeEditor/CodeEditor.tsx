import Editor from "@monaco-editor/react";
import React, { useCallback, useEffect, useRef } from "react";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { debounce } from "lodash";
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
  monacoOptions?: Partial<monaco.editor.IStandaloneEditorConstructionOptions>;
};

export const CodeEditor: React.FC<CodeEditorProps> = ({
  language,
  height,
  width = "100%",
  onChange,
  value,
  ctrlEnterCallback,
  ctrlSCallback,
  changePosition,
  monacoOptions,
  foldLevel,
}) => {
  const editorRef = useRef<any>(null);
  const [mounted, setMounted] = React.useState(false);
  const handleChange = onChange;
  const handleChangePosition = debounce(changePosition ?? (() => {}), 100);

  const handleEditorDidMount = useCallback(
    (editor, monaco) => {
      if (foldLevel) {
        editor.getAction(`editor.foldLevel${foldLevel}`)?.run();
      }
      editorRef.current = editor;
      if (typeof value !== "undefined") {
        editor.setValue(value);
      }
      editor.onDidChangeCursorPosition(e => {
        handleChangePosition(editor.getModel().getOffsetAt(e.position));
      });
      setMounted(true);
    },
    [handleChangePosition, value]
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
      const position = editor.getPosition();
      editor.setValue(value);
      editor.setPosition({ ...position, column: position.column + positionShift });
      //scroll to the end of the line
      editor.revealPosition({ ...position, column: position.column + positionShift + 100 });
      editor.focus();
    }
  }, [value]);

  return (
    <div className="w-full h-full">
      <Editor
        onChange={v => {
          handleChange(v || "");
        }}
        loading={<LoadingAnimation />}
        language={language}
        height={height}
        width={width}
        onMount={handleEditorDidMount}
        className={styles.editor}
        options={{
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

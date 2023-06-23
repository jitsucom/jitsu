import Editor from "@monaco-editor/react";
import React from "react";
import { Radio } from "antd";
import { editor } from "monaco-editor";

/**
 * See tagDestination comments, due to limitations of the react-jsonschema-form we can't use
 * an object as a value, so we have to use a string.
 */
export type SnippedEditorValue = string;

type SupportedLanguages = "html" | "javacript" | "json" | "text";
export type SnippedEditorParsed = {
  lang: SupportedLanguages;
  code?: string;
};

export type SnippedEditorProps = {
  value: SnippedEditorValue;
  languages?: SupportedLanguages[];
  height?: number;
  onChange: (value: SnippedEditorValue) => void;
  options?: editor.IStandaloneEditorConstructionOptions;
  //automatically fold code on provided level of indentation on editor mount
  foldLevel?: number;
};

/**
 * To support historical values which were plain strings
 * @param val
 */
function parse(val: string) {
  try {
    const j = JSON.parse(val);
    if (j.lang && j.code) {
      return j;
    } else {
      return { code: val, lang: "json" };
    }
  } catch (e) {
    return { code: val, lang: "javascript" };
  }
}

export const SnippedEditor: React.FC<SnippedEditorProps> = props => {
  const [value, setValue] = React.useState<SnippedEditorValue>(props.value);

  const valueParsed = value ? (parse(value) as SnippedEditorParsed) : { lang: "javascript", code: "" };
  const singleLanguage = props.languages && props.languages.length === 1;
  return (
    <div>
      {!singleLanguage && (
        <div className="text-right mb-4">
          <Radio.Group
            options={props.languages || ["text"]}
            value={valueParsed.lang}
            onChange={e => {
              const newValue = JSON.stringify({
                ...valueParsed,
                lang: e.target.value.toLowerCase() as SupportedLanguages,
              });
              setValue(newValue);
              props.onChange(newValue);
            }}
          />
        </div>
      )}
      <div className={`border border-textDisabled`}>
        <Editor
          value={valueParsed.code || ""}
          onChange={code => {
            if (singleLanguage) {
              props.onChange(code || "");
            } else {
              const newValue = JSON.stringify({ ...valueParsed, code });
              setValue(newValue);
              props.onChange(newValue);
            }
          }}
          language={valueParsed.lang?.toLowerCase() || "html"}
          height={props.height ? `${props.height}px` : "500px"}
          onMount={
            props.foldLevel
              ? editor => {
                  editor.getAction(`editor.foldLevel${props.foldLevel}`)?.run();
                }
              : undefined
          }
          className="rounded-lg"
          options={{
            renderLineHighlight: "none",
            //readOnly: readonly,
            automaticLayout: true,
            glyphMargin: false,
            folding: false,
            lineNumbers: "off",
            lineDecorationsWidth: 11,
            lineNumbersMinChars: 0,
            minimap: {
              enabled: false,
            },
            scrollbar: {
              verticalScrollbarSize: 5,
              horizontalScrollbarSize: 5,
            },
            padding: {
              top: 4,
              bottom: 4,
            },
            hideCursorInOverviewRuler: true,
            overviewRulerLanes: 0,
            ...props.options,
          }}
        />
      </div>
    </div>
  );
};

import React, { ReactNode } from "react";
import styles from "./FieldListEditorLayout.module.css";
import { DocumentedLabel } from "../DocumentedLabel/DocumentedLabel";
import { Expandable, Title } from "../Expandable/Expandable";
import { WLink } from "../Workspace/WLink";
import { FaExternalLinkAlt } from "react-icons/fa";

export type EditorItem = {
  key?: string;
  name?: ReactNode;
  link?: string;
  documentation?: ReactNode;
  component: ReactNode;
  group?: string;
  itemClassName?: string;
};

export type FieldListEditorLayoutProps = {
  items: (EditorItem | undefined | false)[];
  noBorder?: boolean;
  groups?: Record<
    string,
    | {
        expandable?: boolean;
        hideArrow?: boolean;
        initiallyExpanded?: boolean;
        title?: Title;
        className?: string;
      }
    | undefined
  >;
};

const FieldListEditorLayout: React.FC<FieldListEditorLayoutProps> = props => {
  const items = props.items.filter(item => !!item) as EditorItem[];
  const groups = new Set(items.map(i => i.group));
  if (groups.size === 0 || (groups.size === 1 && groups.has(undefined))) {
    return (
      <div className={props.noBorder ? "" : styles.bordered}>
        <EditorItemTable items={items} />
      </div>
    );
  } else {
    return (
      <div className={`w-full h-full flex flex-col ${props.noBorder ? "" : styles.bordered}`}>
        {[...groups].map(group => {
          const grObj = props?.groups?.[group || ""] || {};
          const expandable = grObj.expandable;
          const list = <EditorItemTable className={grObj.className} items={items.filter(i => i.group === group)} />;
          const title = grObj.title || <h2 className="font-bold my-4 text-xl text-textDark">{group}</h2>;
          return expandable ? (
            <Expandable
              initiallyExpanded={grObj.initiallyExpanded}
              key={group}
              title={title}
              hideArrow={grObj.hideArrow}
              caretSize="1.5em"
              contentLeftPadding={false}
            >
              {list}
            </Expandable>
          ) : (
            <div key={group || "unnamed"} className={"flex-auto flex flex-col overflow-auto"}>
              {typeof title === "function" ? title(true) : title}
              {list}
            </div>
          );
        })}
      </div>
    );
  }
};

function getKey(item: Omit<EditorItem, "group">) {
  if (item.key) {
    return item.key;
  } else if (typeof item.name === "string") {
    return item.name;
  } else {
    throw new Error("FieldListEditorLayout: item.name must be a string if item.key is not specified");
  }
}

const EditorItemTable: React.FC<{ items: Omit<EditorItem, "group">[]; className?: string }> = ({
  items,
  className,
}) => {
  return (
    <div className={`${className ?? styles.editorItemTable} flex-auto`}>
      {items.map(item => (
        <div className={`${styles.editorItemRow} h-full`} key={getKey(item)}>
          {item.name && (
            <div className={styles.name}>
              <div className={`flex flex-row items-center gap-2`}>
                <DocumentedLabel name={item.name} doc={item.documentation} />
                {item.link && (
                  <WLink href={item.link} target={"_blank"} rel={"noreferrer noopener"}>
                    <FaExternalLinkAlt className={"w-2.5 h-2.5"} />
                  </WLink>
                )}
              </div>
            </div>
          )}
          <div className={item.itemClassName ?? styles.component}> {item.component}</div>
        </div>
      ))}
    </div>
  );
};

export default FieldListEditorLayout;

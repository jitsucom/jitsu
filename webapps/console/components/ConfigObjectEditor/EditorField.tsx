import React from "react";
import styles from "./ConfigEditor.module.css";
import { FaExclamationCircle } from "react-icons/fa";

export type EditorFieldProps = {
  id: string;
  required?: boolean;
  className?: string;
  help?: React.ReactNode;
  label: React.ReactNode;
  errors?: React.ReactNode;
};

const EditorField0: React.FC<React.PropsWithChildren<EditorFieldProps>> = ({
  id,
  required,
  className,
  help,
  label,
  errors,
  children,
}) => {
  return (
    <div className={`${className ?? ""} border rounded-lg border-backgroundDark mb-4`}>
      <div className={`px-6 pt-2 pb-3.5 ${!help && "pb-6"}`}>
        <div className="flex items-center mb-2 justify-between">
          <label className="text-xl flex items-center" htmlFor={id}>
            {label}
            {required && <span className={styles.required}>(required)</span>}
          </label>
          <div>
            <div className={`text-error pr-2  flex items-center space-x-1 ${!!errors ? "visible" : "invisible"}`}>
              {errors}
              <FaExclamationCircle className={"ml-1.5"} />
            </div>
          </div>
        </div>
        <div className={`${!!errors && styles.invalidInput}`}>{children}</div>
      </div>
      {!!help && (
        <div className={`px-6 py-2.5 border-t bg-background text-textLight  rounded-b-lg ${styles.help}`}>
          <div className="">{help}</div>
        </div>
      )}
    </div>
  );
};

const EditorFieldInner: React.FC<React.PropsWithChildren<EditorFieldProps>> = ({
  id,
  required,
  className,
  help,
  label,
  errors,
  children,
}) => {
  return (
    <div className={`${className ?? ""} px-4 pt-2.5 ${styles.inner}`}>
      <div className={`pl-0.5`}>
        <div className="flex items-center justify-between">
          <label className="flex items-center" htmlFor={id}>
            {label}
            {required && <span className={"ml-2 text-text"}>(required)</span>}
          </label>
          <div>
            <div className={`text-error pr-2 flex items-center space-x-1 ${!!errors ? "visible" : "invisible"}`}>
              {errors}
              <FaExclamationCircle className={"ml-1.5"} />
            </div>
          </div>
        </div>
      </div>
      <div className={`${!!errors && styles.invalidInput}`}>{children}</div>
      <div className={" text-textLight"}>
        {!!help && (
          <div className={`pl-0.5 py-0.5 text-xs ${styles.help}`}>
            <div className="">{help}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export const EditorField: React.FC<React.PropsWithChildren<{ inner?: boolean } & EditorFieldProps>> = ({
  inner,
  ...props
}) => {
  return inner ? <EditorFieldInner {...props} /> : <EditorField0 {...props} />;
};

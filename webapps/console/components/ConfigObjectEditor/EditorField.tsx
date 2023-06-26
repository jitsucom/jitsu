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

export const EditorField: React.FC<React.PropsWithChildren<EditorFieldProps>> = ({
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
      <div className={`px-6 py-4 ${!help && "pb-8"}`}>
        <div className="flex items-center mb-4 justify-between">
          <label className="text-xl flex items-center" htmlFor={id}>
            {label}
            {required && <span className={styles.required}>(required)</span>}
          </label>
          <div>
            <div
              className={`text-error px-2 py-1 mt-1   flex items-center space-x-1 ${
                !!errors ? "visible" : "invisible"
              }`}
            >
              <div>
                <FaExclamationCircle />
              </div>
              <div className="font-bold">{label}</div>
              {errors}
            </div>
          </div>
        </div>
        <div className={`${!!errors && styles.invalidInput}`}>{children}</div>
      </div>
      {!!help && (
        <div className={`px-6 py-4 border-t bg-background text-textLight font-thin  rounded-b-lg ${styles.help}`}>
          <div className="">{help}</div>
        </div>
      )}
    </div>
  );
};

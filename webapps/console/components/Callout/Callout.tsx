import { PropsWithChildren, ReactNode } from "react";
import { FaExclamationTriangle, FaInfoCircle, FaLightbulb } from "react-icons/fa";
import * as theme from "../../theme.config";

export type Variant = "note" | "tip" | "info" | "caution" | "danger";

function NoteIcon() {
  return (
    <svg viewBox="0 0 14 16" width="100%" height="100%">
      <path
        fillRule="evenodd"
        d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"
      />
    </svg>
  );
}

function TipIcon() {
  return (
    <svg viewBox="0 0 12 16" width="100%" height="100%">
      <path
        fillRule="evenodd"
        d="M6.5 0C3.48 0 1 2.19 1 5c0 .92.55 2.25 1 3 1.34 2.25 1.78 2.78 2 4v1h5v-1c.22-1.22.66-1.75 2-4 .45-.75 1-2.08 1-3 0-2.81-2.48-5-5.5-5zm3.64 7.48c-.25.44-.47.8-.67 1.11-.86 1.41-1.25 2.06-1.45 3.23-.02.05-.02.11-.02.17H5c0-.06 0-.13-.02-.17-.2-1.17-.59-1.83-1.45-3.23-.2-.31-.42-.67-.67-1.11C2.44 6.78 2 5.65 2 5c0-2.2 2.02-4 4.5-4 1.22 0 2.36.42 3.22 1.19C10.55 2.94 11 3.94 11 5c0 .66-.44 1.78-.86 2.48zM4 14h5c-.23 1.14-1.3 2-2.5 2s-2.27-.86-2.5-2z"
      />
    </svg>
  );
}

export const icons: Record<Variant, React.ReactNode> = {
  caution: <FaExclamationTriangle />,
  danger: undefined,
  info: <FaInfoCircle />,
  note: <FaInfoCircle />,
  tip: <FaLightbulb />,
};

const colors: Record<Variant, string> = {
  danger: theme.error,
  info: theme.primaryLighter,
  note: theme.textDark,
  tip: theme.success,
  caution: theme.warning,
};

export const Callout: React.FC<PropsWithChildren<{ variant: Variant; title?: ReactNode }>> = ({
  title,
  variant,
  children,
}) => {
  if (variant === "danger") {
    throw new Error("danger variant is not supported");
  }
  const color = `${colors[variant]}`;
  return (
    <div
      className={`rounded-l rounded-r-lg shadow-sm border-l-4  px-5 py-3`}
      style={{
        borderColor: color,
        backgroundColor: color + "1A",
      }}
    >
      <div className={`flex items-center`}>
        <div>{icons[variant]}</div>
        <div className="ml-2 text-textLight font-bold uppercase">{title || variant}</div>
      </div>
      {children}
    </div>
  );
};

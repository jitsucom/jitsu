import React, { ErrorInfo, ReactNode } from "react";
import { CodeBlock } from "../CodeBlock/CodeBlock";
import { FaExclamationCircle } from "react-icons/fa";
import { Button, Collapse } from "antd";
import { getErrorMessage, getLog } from "juava";
import { PropsWithChildrenClassname } from "../../lib/ui";
import { AlertCircle } from "lucide-react";
import classNames from "classnames";
import { signOut } from "next-auth/react";
import { firebaseSignOut } from "../../lib/firebase-client";

export type GlobalErrorProps = {
  error?: any;
  title?: string;
  children?: ReactNode;
  hideActions?: boolean;
};

export type ErrorProps = { error: Error; errorInfo: ErrorInfo };

export class ErrorBoundary extends React.Component<
  { children: ReactNode; renderError: (props: ErrorProps) => ReactNode },
  ErrorProps
> {
  constructor(props) {
    super(props);
  }

  componentDidCatch(error, errorInfo) {
    console.log(`Unhandled React error: ${errorInfo?.componentStack}  `, error);
    this.setState({
      error: error,
      errorInfo: errorInfo,
    });
  }

  render() {
    if (this.state?.error) {
      return this.props.renderError(this.state);
    }
    return this.props.children;
  }
}

export function ErrorDetails(props: { error: any }) {
  const message = props.error?.message && `${props.error.message}`;
  const stack = props.error?.stack && `${props.error.stack}`;
  return (
    <Collapse defaultActiveKey={"error"}>
      {message && (
        <Collapse.Panel key={"error"} header={<div className="font-bold text-sm">Error</div>}>
          <CodeBlock breaks={"words"}>{message}</CodeBlock>
        </Collapse.Panel>
      )}
      {props.error.response && (
        <Collapse.Panel key={"response"} header={<div className="font-bold text-sm">Response</div>}>
          <CodeBlock breaks={"words"} lang="json">
            {JSON.stringify(props.error.response, null, 2)}
          </CodeBlock>
        </Collapse.Panel>
      )}
      {props.error.request && (
        <Collapse.Panel key={"request"} header={<div className="font-bold text-sm">Request</div>}>
          <CodeBlock breaks={"words"} lang="json">
            {JSON.stringify(props.error.request, null, 2)}
          </CodeBlock>
        </Collapse.Panel>
      )}
      {stack && (
        <Collapse.Panel key={"stack"} header={<div className="font-bold text-sm">Stack</div>}>
          <CodeBlock breaks={"words"}>{stack}</CodeBlock>
        </Collapse.Panel>
      )}
    </Collapse>
  );
}

const log = getLog("error");

export const EmbeddedErrorMessage: React.FC<PropsWithChildrenClassname<{ actions?: ReactNode }>> = ({
  children,
  className,
  actions,
}) => (
  <div
    className={classNames(
      `border border-error bg-error/5 px-3 py-4 text-error rounded-md w-full flex  flex-nowrap items-start`,
      className
    )}
  >
    <AlertCircle className="h-4 w-4 mr-4 p-0 m-0" />
    <div>
      {children}
      {actions && <div className="ml-auto mt-4">{actions}</div>}
    </div>
  </div>
);

function maxLen(str: string, maxLen = 200) {
  return str.length <= maxLen - 2 ? str : str.substring(0, maxLen) + "...";
}

export function ErrorCard(props: { error?: any; title?: string; hideActions?: boolean; children?: ReactNode }) {
  const title = props.title || (props.error ? maxLen(getErrorMessage(props.error), 60) : "Error");
  const description = (
    <>
      {props.children || `We encountered an error processing your request`}. Please try refreshing the page, or logging
      out and back in. If the problem persists, please contact support.
    </>
  );
  const [detailsVisible, setDetailsVisible] = React.useState(false);
  const universalSignOut = async () => {
    //we can't use current session here, since the error can be originated
    //from auth layer. Try to logout using all methods
    signOut().catch(err => {
      log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
    });
    firebaseSignOut().catch(err => {
      log.atWarn().withCause(err).log(`Can't sign ut from next-auth`);
    });
  };
  return (
    <div
      className="max-w-screen-md  px-6 py-4 border border-error/20 rounded-xl bg-error/5 w-full overflow-auto mx-auto"
      style={{ maxHeight: "80vh", maxWidth: "90vw" }}
    >
      <div className="text-error text-lg flex items-center">
        <div className="flex items-center">
          <FaExclamationCircle className="h-4 w-4 mr-2" />
          {title}
        </div>
      </div>
      <div className="pl-6 text-sm text-error font-light">
        <div>{description}</div>
        {!props.hideActions && (
          <div className="pt-2 -ml-2 flex items-center justify-start gap-2">
            <Button size="small" type="link" onClick={universalSignOut}>
              Logout
            </Button>
            <Button size="small" type="link" onClick={() => window.location.reload()} className="mt-0.5">
              Reload
            </Button>
            {props.error && (
              <Button size="small" type="link" onClick={() => setDetailsVisible(!detailsVisible)} className="mt-0.5">
                {detailsVisible ? "Hide technical details" : "Show technical details"}
              </Button>
            )}
          </div>
        )}
      </div>
      {props.error && detailsVisible && (
        <div className="mt-6">
          {(props.error?.stack || props.error?.message) && <ErrorDetails error={props.error} />}
          {typeof props.error === "string" && <ErrorDetails error={{ message: props.error }} />}
        </div>
      )}
    </div>
  );
}

export const GlobalOverlay: React.FC<PropsWithChildrenClassname<{}>> = ({ children, className }) => (
  <div
    className={`fixed top-0 left-0 flex justify-center flex-col items-center justify-center my-4 m-0 p-0 z-50 overflow-hidden w-screen h-screen bg-background ${
      className || ""
    }`}
  >
    {children}
  </div>
);

export const GlobalError: React.FC<GlobalErrorProps> = props => (
  <GlobalOverlay>
    <ErrorCard {...props} />
  </GlobalOverlay>
);

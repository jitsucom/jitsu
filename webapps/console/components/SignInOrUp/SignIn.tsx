import { branding } from "../../lib/branding";
import { Alert, Button, Collapse, Input } from "antd";
import React, { PropsWithChildren, ReactNode, useState } from "react";
import { GithubOutlined, GoogleOutlined } from "@ant-design/icons";
import { useModalPrompt } from "../../lib/modal";
import { getLog } from "juava";
import Link from "next/link";
import { useQueryStringCopy } from "./use-query-string-copy";
import { useRouter } from "next/router";
import { BaseRouter } from "next/dist/shared/lib/router/router";

const theme = require("../../theme.config");

function JitsuLogo() {
  return (
    <div className="flex items-center w-fit h-full space-x-2">
      <div className="aspect-square h-full">{branding.logo}</div>
      <div className="text-textDark h-4/6">{branding.wordmark}</div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex justify-center my-12 items-center">
      <div className="h-12">
        <JitsuLogo />
      </div>
    </div>
  );
}

export const log = getLog("signin");

function handleFirebaseError(error: any): ReactNode {
  const code = error?.code;
  log
    .atError()
    .withCause(error)
    .log(`Firebase authorization error: ${JSON.stringify(error, null, 2)}`);
  if (code === "auth/account-exists-with-different-credential") {
    const email = error?.customData?.email;
    return (
      <>
        The account
        {email ? (
          <>
            {" "}
            for <b>{email}</b>
          </>
        ) : (
          ""
        )}{" "}
        exists, but different sign in method has been used to create this account. Please try to sign in with another
        method.
      </>
    );
  } else if (code === "auth/popup-closed-by-user") {
    return "Auth popup was closed by user. Please try again.";
  } else if (code === "auth/invalid-email") {
    return "Invalid email";
  } else if (code === "auth/wrong-password") {
    return "Invalid password";
  } else if (code === "auth/user-not-found") {
    return "User not found";
  } else if (code === "auth/too-many-requests") {
    return "Too many signin attempts. Try later, or reset password now";
  }

  return (error?.message || "Unknown auth error").replace("Firebase: ", "");
}

function redirectIfNeeded(router: BaseRouter) {
  if (router.query.redir) {
    window.location.href = router.query.redir as string;
  }
}

export const SocialLogin: React.FC<{ onSocialLogin: (type: string) => Promise<void>; prefix?: string }> = ({
  onSocialLogin,
  ...props
}) => {
  const [loading, setLoading] = useState<"google.com" | "github.com" | undefined>();
  const prefix = props.prefix || "Sign in";
  const [error, setError] = useState<ReactNode | undefined>();
  const router = useRouter();
  return (
    <div className="flex flex-col items-center">
      <div className="pt-0 sm:pt-6 flex flex-col sm:flex-row space-y-2 sm:space-x-2 sm:space-y-0 justify-between">
        <Button
          loading={loading === "google.com"}
          disabled={!!loading}
          size="large"
          icon={<GoogleOutlined />}
          onClick={async () => {
            try {
              setLoading("google.com");
              await onSocialLogin("google.com");
              redirectIfNeeded(router);
            } catch (error: any) {
              setError(handleFirebaseError(error));
            } finally {
              setLoading(undefined);
            }
          }}
        >
          {prefix} with Google
        </Button>
        <Button
          size="large"
          icon={<GithubOutlined />}
          loading={loading === "github.com"}
          disabled={!!loading}
          onClick={async () => {
            try {
              setLoading("github.com");
              await onSocialLogin("github.com");
              redirectIfNeeded(router);
            } catch (error: any) {
              console.log(JSON.stringify(error, null, 2));
              setError(handleFirebaseError(error));
            } finally {
              setLoading(undefined);
            }
          }}
        >
          {prefix} with GitHub
        </Button>
      </div>
      {error && (
        <div className="mt-6 shrink w-96">
          <Alert
            message="Authentication error"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(undefined)}
          />
        </div>
      )}
    </div>
  );
};

const PasswordForm: React.FC<Pick<SigninProps, "onPasswordLogin">> = ({ onPasswordLogin }) => {
  const prompt = useModalPrompt();
  const [email, setEmail] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReactNode | undefined>();
  const router = useRouter();
  return (
    <div>
      <div className="font-bold text-textLight  tracking-wide pb-2">Email</div>
      <div>
        <Input placeholder="chandler.bing@example.com" onChange={e => setEmail(e.target.value)}></Input>
      </div>
      <div className="font-bold text-textLight  tracking-wide pb-2 pt-4 flex justify-between">
        <span>Password</span>
        <span>
          <a
            tabIndex={4}
            className="pr-0 hover:text-textLight"
            href={`/reset-password?email=${email ? encodeURIComponent(email) : ""}`}
          >
            Reset
          </a>
        </span>
      </div>
      <div>
        <Input.Password onChange={e => setPassword(e.target.value)} placeholder={"•".repeat(10)}></Input.Password>
      </div>
      {error && (
        <div className="mt-6">
          <Alert
            message="Authentication error"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(undefined)}
          />
        </div>
      )}
      <Button
        className="large w-full mt-6"
        type="primary"
        loading={loading}
        onClick={async () => {
          if (!email || !password) {
            return;
          }
          try {
            setLoading(true);
            setError(undefined);
            await onPasswordLogin(email, password);
            redirectIfNeeded(router);
          } catch (e: any) {
            const message = e?.message || "Unknown error";
            log
              .atError()
              .withCause(e)
              .log(`Signin failed: ${message} - ${JSON.stringify(e)}`);
            setError(handleFirebaseError(e));
          } finally {
            setLoading(false);
          }
        }}
      >
        Sign in
      </Button>
    </div>
  );
};

export const SigninLayout: React.FC<PropsWithChildren<{ title: ReactNode; footer?: ReactNode }>> = ({
  title,
  children,
  footer,
}) => {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className={"flex flex-col items-center sm:justify-center grow"}>
        <div className="bg-backgroundLight p-8 border border-backgroundDark rounded-md shadow-sm mx-4">
          <div className="flex justify-center text-3xl font-header font-bold mb-4">{title}</div>
          {router.query.invite && (
            <div className="text text-textLight">Login to Jitsu to accept the invitation, or create an account</div>
          )}
          <div className="debug">{children}</div>
        </div>
        {footer && <div>{footer}</div>}
      </div>
    </div>
  );
};

export type SigninProps = {
  engine: "firebase" | "nextauth";
  variant: "signin" | "signup";
  enablePassword?: boolean;
  onPasswordLogin: (email: string, password: string) => Promise<void>;
  onSocialLogin: (type: string) => Promise<void>;
};

export const SignIn: React.FC<SigninProps> = props => {
  const { enablePassword, onSocialLogin } = props;
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const queryStringCopy = useQueryStringCopy();

  return (
    <SigninLayout
      footer={
        <div className="text-center mt-4">
          New to {branding.productName}?{" "}
          <Link className="font-bold text-primary" href={`signup${queryStringCopy}`}>
            Create an account!
          </Link>
        </div>
      }
      title={
        <div className="h-12 flex justify-center">
          <JitsuLogo />
        </div>
      }
    >
      <SocialLogin onSocialLogin={onSocialLogin} />
      {enablePassword && (
        <>
          {/*<div className="border-t border-backgroundDark relative flex justify-center text-xs uppercase mt-12">*/}
          {/*  <span className="bg-backgroundLight text-textLight px-2 -mt-2.5 text-gray-500">*/}
          {/*    Or continue with password*/}
          {/*  </span>*/}
          {/*</div>*/}
          <div className="mt-6">
            <Collapse bordered={false}>
              <Collapse.Panel header="Login with email and password" key="1">
                <PasswordForm {...props} />
              </Collapse.Panel>
            </Collapse>
          </div>
          {/*{showPasswordLogin && <PasswordForm {...props} />}*/}
        </>
      )}
    </SigninLayout>
  );
};

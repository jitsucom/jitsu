import { branding } from "../../lib/branding";
import React, { PropsWithChildren, ReactNode, useState } from "react";
import Link from "next/link";
import { useQueryStringCopy } from "./use-query-string-copy";
import { useRouter } from "next/router";
import { EmailFirstLogin } from "./EmailFirstLogin";
import { OAuthButtons } from "./OAuthButtons";
import { signIn } from "next-auth/react";
import { useFirebaseSession } from "../../lib/firebase-client";
import { useJitsu } from "@jitsu/jitsu-react";
import { useAppConfig } from "../../lib/context";
import { safeRedirect } from "../../lib/auth-redirect";
import { Alert } from "antd";

export type AuthType =
  | "firebase-password"
  | "firebase-google"
  | "firebase-github"
  | "nextauth-github"
  | "nextauth-credentials"
  | "nextauth-oidc"
  | "dynamic-oidc"
  | "none";

function JitsuLogo() {
  return (
    <div className="flex items-center w-fit h-full space-x-2">
      <div className="aspect-square h-full">{branding.logo}</div>
      <div className="text-textDark h-4/6">{branding.wordmark}</div>
    </div>
  );
}

//TODO: detect that callbackUrl leads to /accept and show appropriate message
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
  signup?: boolean;
};

export const SignInOrUp: React.FC<SigninProps> = ({ signup }) => {
  const queryStringCopy = useQueryStringCopy();
  const router = useRouter();
  const appConfig = useAppConfig();
  const firebaseSession = useFirebaseSession();
  const { analytics } = useJitsu();
  const [error, setError] = useState<string | null>(null);

  const callbackUrl = (router.query.callbackUrl as string) || "/";

  // Determine available auth methods
  const hasFirebase = !!appConfig.auth?.firebasePublic;
  const hasDynamicOidc = !!appConfig.auth?.dynamicOidc;
  const showSignupLink = !signup && !appConfig.disableSignup;

  // Build the list of available OAuth providers
  const ssoProviders: Array<"firebase-google" | "firebase-github" | "nextauth-github" | "nextauth-oidc"> = [];
  if (hasFirebase) {
    ssoProviders.push("firebase-google", "firebase-github");
  } else {
    if (appConfig.auth?.nextauth?.github) {
      ssoProviders.push("nextauth-github");
    }
    if (appConfig.auth?.nextauth?.oidc) {
      ssoProviders.push("nextauth-oidc");
    }
  }

  const showEmailLogin = hasFirebase || hasDynamicOidc || (appConfig.auth?.nextauth?.credentials && !signup);

  const handlePasswordLogin = async (email: string, password: string, type: AuthType) => {
    try {
      if (type === "firebase-password") {
        const success = await firebaseSession!.signIn(email, password);
        if (!success) {
          setError("Invalid email or password");
          return;
        }
        const user = await firebaseSession!.resolveUser().user;
        if (!user) {
          setError("Sign in failed");
        }
        await analytics.track("login", {
          traits: { ...user, type: "password", loginProvider: "firebase/email" },
        });
        safeRedirect(router, callbackUrl);
      } else if (type === "nextauth-credentials") {
        const result = await signIn("credentials", {
          username: email,
          password,
          redirect: false,
          callbackUrl,
        });

        if (result?.error) {
          setError(result.error);
        }

        if (result?.ok) {
          safeRedirect(router, callbackUrl);
        } else {
          setError("Invalid email or password");
        }
      } else {
        setError("Unsupported authentication method");
      }
    } catch (e: any) {
      if (type === "firebase-password") {
        setError(handleFirebaseError(e));
        await analytics.track("login_error", {
          email,
          type: "password",
          loginProvider: "firebase/email",
          message: e?.message || "Unknown error",
        });
      } else {
        setError(e.message || "Authentication failed");
      }
    }
  };

  const handleSSOLogin = async (provider: AuthType, providerId: string, loginHint?: string) => {
    try {
      switch (provider) {
        case "firebase-google":
        case "firebase-github":
          await firebaseSession!.signInWith(provider === "firebase-google" ? "google.com" : "github.com");
          const user = await firebaseSession!.resolveUser().user;
          if (!user) {
            setError("Sign in failed");
            return;
          }
          await analytics.track("login", {
            traits: { ...user, type: "social", loginProvider: `firebase/${provider}` },
          });
          safeRedirect(router, callbackUrl);
          break;
        case "nextauth-github":
          await signIn("github", { callbackUrl }, { ...(loginHint ? { login_hint: loginHint } : {}), prompt: "login" });
          break;
        case "nextauth-oidc":
          await signIn("oidc", { callbackUrl }, { ...(loginHint ? { login_hint: loginHint } : {}), prompt: "login" });
          break;
        case "dynamic-oidc":
          window.location.href = `/api/auth/dynamic-oidc/authorize?providerId=${providerId}&callbackUrl=${encodeURIComponent(
            callbackUrl
          )}${loginHint ? `&loginHint=${encodeURIComponent(loginHint)}` : ""}`;
          break;
        default:
          setError(`Unsupported authentication provider: ${provider}`);
      }
    } catch (e: any) {
      if (provider.startsWith("firebase-")) {
        setError(handleFirebaseError(e));
        await analytics.track("login_error", {
          type: "social",
          loginProvider: `firebase/${provider}`,
          message: e?.message || "Unknown error",
        });
      } else {
        setError(e.message || "Authentication failed");
      }
    }
  };

  return (
    <>
      <SigninLayout
        footer={
          showSignupLink ? (
            <div className="text-center mt-4">
              New to {branding.productName}?{" "}
              <Link className="font-bold text-primary" href={`/signup${queryStringCopy}`}>
                Create an account!
              </Link>
            </div>
          ) : null
        }
        title={
          <div className="h-12 flex justify-center">
            <JitsuLogo />
          </div>
        }
      >
        {ssoProviders.length > 0 && (
          <OAuthButtons prefix={signup ? "Sign Up" : "Sign In"} providers={ssoProviders} onSSOLogin={handleSSOLogin} />
        )}
        {showEmailLogin && (
          <>
            {ssoProviders.length > 0 && (
              <div className="relative mt-6 mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-backgroundLight text-gray-500">Or continue with email</span>
                </div>
              </div>
            )}
            <div className={ssoProviders.length === 0 ? "" : ""}>
              <EmailFirstLogin
                onPasswordLogin={async (email, password, type) => {
                  try {
                    await handlePasswordLogin(email, password, type);
                  } catch (e: any) {
                    setError(e.message || "Authentication failed");
                  }
                }}
                onSSOLogin={handleSSOLogin}
              />
            </div>
          </>
        )}
        {error && (
          <div className="mx-auto max-w-[350px] mt-4">
            <Alert type="error" message={error} closable onClose={() => setError(null)} />
          </div>
        )}

        {router.query.error && (
          <div className="mx-auto max-w-[350px] mt-4">
            <Alert type="error" message={`Authentication error: ${router.query.error}`} closable />
          </div>
        )}
      </SigninLayout>
    </>
  );
};

function handleFirebaseError(error: any): string {
  const code = error?.code;
  if (code === "auth/account-exists-with-different-credential") {
    const email = error?.customData?.email;
    return `The account ${
      email ? `for '${email}'` : ""
    } exists, but different sign in method has been used to create this account. Please try to sign in with another method.`;
  } else if (code === "auth/popup-closed-by-user") {
    return "Auth popup was closed by user. Please try again.";
  } else if (code === "auth/invalid-email") {
    return "Invalid email or password";
  } else if (code === "auth/wrong-password") {
    return "Invalid email or password";
  } else if (code === "auth/user-not-found") {
    return "Invalid email or password";
  } else if (code === "auth/too-many-requests") {
    return "Too many signin attempts. Try later, or reset password now";
  }

  return (error?.message || "Unknown auth error").replace("Firebase: ", "");
}

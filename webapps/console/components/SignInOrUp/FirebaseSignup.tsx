import React, { ReactNode, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Alert, Button, Input } from "antd";
import { CheckCircleOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import { branding } from "../../lib/branding";
import { useFirebaseSession } from "../../lib/firebase-client";
import { safeRedirect } from "../../lib/auth-redirect";
import { useJitsu } from "@jitsu/jitsu-react";
import { OAuthButtons } from "./OAuthButtons";
import { AuthType, handleFirebaseError } from "./SignInOrUp";
import { useQueryStringCopy } from "./use-query-string-copy";

const JITSU_PURPLE = "#AA00FF";

type Feature = { title: string; description: string; href: string };

// Every feature links to the matching jitsu.com page (no doc-less claims).
const features: Feature[] = [
  {
    title: "Real-time event streaming",
    description: "Stream events to your data warehouse the moment they happen.",
    href: "https://jitsu.com/features/event-streaming",
  },
  {
    title: "Jitsu Functions",
    description: "Transform and enrich events in-flight with TypeScript.",
    href: "https://jitsu.com/features/functions",
  },
  {
    title: "Identity stitching",
    description: "Resolve anonymous and known users into one identity automatically.",
    href: "https://jitsu.com/features/identity-stitching",
  },
  {
    title: "Segment-compatible SDKs",
    description: "Drop-in replacement for Segment — keep your existing instrumentation.",
    href: "https://jitsu.com/features/segment-compatibility",
  },
];

const customers = ["PandaDoc", "Investing.com", "Rarible", "Census", "Embeddables"];

const MarketingPanel: React.FC = () => (
  <div
    className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 xl:p-16 text-white"
    style={{ background: `linear-gradient(160deg, ${JITSU_PURPLE} 0%, #7C00C0 100%)` }}
  >
    <div className="flex items-center gap-2">
      <div className="h-9 w-9 bg-white rounded-lg p-1 flex items-center justify-center">{branding.logo}</div>
      <span className="text-2xl font-bold tracking-tight">{branding.productName}</span>
    </div>

    <div className="max-w-md">
      <h2 className="text-3xl xl:text-4xl font-header font-bold leading-tight">Capture event data into your stack</h2>
      <p className="mt-4 text-white/80">
        Collect events from web, app, and server — and stream them to your data warehouse in real time.
      </p>
      <div className="mt-8 flex flex-col gap-1">
        {features.map(f => (
          <a
            key={f.href}
            href={f.href}
            target="_blank"
            rel="noreferrer"
            className="group flex items-start gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-white/10"
          >
            <CheckCircleOutlined className="mt-1 text-lg text-white/90" />
            <span>
              <span className="font-semibold group-hover:underline">{f.title}</span>
              <span className="block text-sm text-white/70">{f.description}</span>
            </span>
          </a>
        ))}
      </div>
    </div>

    <div>
      <div className="text-xs uppercase tracking-wider text-white/60">Trusted by data teams at</div>
      <div className="mt-2 text-sm text-white/90">{customers.join("  ·  ")}</div>
      <a
        href="https://jitsu.com/customers"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-sm font-semibold text-white hover:underline"
      >
        Read customer stories →
      </a>
    </div>
  </div>
);

const FieldLabel: React.FC<{ icon: ReactNode; children: ReactNode }> = ({ icon, children }) => (
  <div className="font-bold text-textLight tracking-wide pb-2 flex items-center">
    <span className="mr-2">{icon}</span>
    {children}
  </div>
);

export const FirebaseSignup: React.FC = () => {
  const router = useRouter();
  const firebaseSession = useFirebaseSession();
  const { analytics } = useJitsu();
  const queryStringCopy = useQueryStringCopy();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ReactNode | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const callbackUrl = (router.query.callbackUrl as string) || "/";

  const validate = (): string | null => {
    if (!email || !email.includes("@")) {
      return "Please enter a valid email address";
    }
    if (password.length < 6) {
      return "Password must be at least 6 characters";
    }
    if (password !== confirm) {
      return "Passwords do not match";
    }
    return null;
  };

  const mapSignupError = (e: any): ReactNode => {
    const code = e?.code;
    if (code === "auth/email-already-in-use") {
      return (
        <>
          An account with this email already exists.{" "}
          <Link className="font-bold underline" href={`/signin${queryStringCopy}`}>
            Sign in
          </Link>{" "}
          instead.
        </>
      );
    }
    if (code === "auth/weak-password") {
      return "Password is too weak. Use at least 6 characters.";
    }
    if (code === "auth/invalid-email") {
      return "Please enter a valid email address";
    }
    return handleFirebaseError(e);
  };

  const handleSignup = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await firebaseSession.signUp(email, password);
      await analytics.track("sign_up", { email, loginProvider: "firebase/email" });
      // The new account is single-provider `password` + unverified, so the route
      // gate (FirebaseAuthorizer) takes over and renders VerifyEmailGate.
      safeRedirect(router, callbackUrl);
    } catch (e: any) {
      setError(mapSignupError(e));
      await analytics.track("sign_up_error", {
        email,
        loginProvider: "firebase/email",
        message: e?.message || "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // OAuth signup is the same popup path as sign-in — Firebase creates the account
  // on first login. signInWith already records the login and fires analytics.
  const handleSSOLogin = async (provider: AuthType) => {
    try {
      await firebaseSession.signInWith(provider === "firebase-google" ? "google.com" : "github.com");
      safeRedirect(router, callbackUrl);
    } catch (e: any) {
      setError(handleFirebaseError(e));
      await analytics.track("login_error", {
        type: "social",
        loginProvider: `firebase/${provider}`,
        message: e?.message || "Unknown error",
      });
    }
  };

  return (
    <div className="flex min-h-screen">
      <MarketingPanel />
      <div className="flex-1 flex flex-col overflow-y-auto bg-backgroundLight">
        <div className="m-auto w-full max-w-[400px] px-6 py-12">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="h-12 w-12">{branding.logo}</div>
            <h1 className="mt-4 text-3xl font-header font-bold text-textDark">Create your account</h1>
          </div>

          <OAuthButtons
            prefix="Sign Up"
            providers={["firebase-google", "firebase-github"]}
            onSSOLogin={handleSSOLogin}
          />

          <div className="relative mt-6 mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-backgroundLight text-gray-500">Or sign up with email</span>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <FieldLabel icon={<MailOutlined />}>Email</FieldLabel>
              <Input
                size="large"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder="Enter your email address"
                disabled={submitting}
              />
            </div>
            <div>
              <FieldLabel icon={<LockOutlined />}>Password</FieldLabel>
              <Input.Password
                size="large"
                autoComplete="new-password"
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Create a password (min 6 characters)"
                disabled={submitting}
              />
            </div>
            <div>
              <FieldLabel icon={<LockOutlined />}>Confirm password</FieldLabel>
              <Input.Password
                size="large"
                autoComplete="new-password"
                value={confirm}
                onChange={e => {
                  setConfirm(e.target.value);
                  setError(null);
                }}
                placeholder="Re-enter your password"
                onPressEnter={handleSignup}
                disabled={submitting}
              />
            </div>

            <Button
              className="w-full"
              type="primary"
              size="large"
              loading={submitting}
              onClick={handleSignup}
              disabled={!email || !password || !confirm}
            >
              Create account
            </Button>

            {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

            <div className="text-xs text-textLight text-center">
              By creating an account you agree to our{" "}
              <a className="hover:text-primary" href="https://jitsu.com/tos" target="_blank" rel="noreferrer">
                Terms
              </a>{" "}
              and{" "}
              <a className="hover:text-primary" href="https://jitsu.com/privacy" target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
              .
            </div>
          </div>

          <div className="text-center mt-8 text-textLight">
            Already have an account?{" "}
            <Link className="font-bold text-primary" href={`/signin${queryStringCopy}`}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

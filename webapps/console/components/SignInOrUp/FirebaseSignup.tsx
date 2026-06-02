import React, { ReactNode, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Alert, Button, Divider, Input } from "antd";
import { branding } from "../../lib/branding";
import { useFirebaseSession } from "../../lib/firebase-client";
import { safeRedirect } from "../../lib/auth-redirect";
import { useJitsu } from "@jitsu/jitsu-react";
import { OAuthButtons } from "./OAuthButtons";
import { SignupMarketingPanel } from "./SignupMarketingPanel";
import { AuthType, handleFirebaseError } from "./SignInOrUp";
import { useQueryStringCopy } from "./use-query-string-copy";

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
  const [emailConfirmed, setEmailConfirmed] = useState(false);

  const callbackUrl = (router.query.callbackUrl as string) || "/";

  // Step 1 → 2: reveal the password fields only once a plausible email is entered.
  const handleContinue = () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setError(null);
    setEmailConfirmed(true);
  };

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
    setError(null);
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
      <SignupMarketingPanel />

      <div className="flex w-full flex-col bg-white lg:w-1/2 overflow-y-auto">
        <div className="shrink-0 p-6 text-right text-sm text-textLight">
          Already have an account?{" "}
          <Link className="font-semibold text-primary" href={`/signin${queryStringCopy}`}>
            Sign in →
          </Link>
        </div>

        <div className="flex flex-1 justify-center px-6">
          <div className="my-auto w-full max-w-[420px] py-8">
            <div className="mb-6 h-12 w-12 drop-shadow-sm">{branding.logo}</div>

            <h1 className="font-header text-3xl xl:text-4xl font-bold leading-tight text-textDark">
              Join 8,000+ teams shipping data with Jitsu.
            </h1>
            <p className="mt-3 text-textLight">Free for 200k events/month. No credit card required.</p>

            <div className="mt-4">
              <OAuthButtons
                prefix="Continue"
                providers={["firebase-google", "firebase-github"]}
                onSSOLogin={handleSSOLogin}
              />
            </div>

            <Divider plain>
              <span className="text-xs uppercase tracking-widest text-textLight">or with email</span>
            </Divider>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-textDark">Work email</label>
                <Input
                  size="large"
                  variant="filled"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    setError(null);
                    setEmailConfirmed(false);
                  }}
                  onPressEnter={handleContinue}
                  disabled={submitting}
                />
              </div>

              {!emailConfirmed && (
                <Button
                  block
                  type="primary"
                  size="large"
                  onClick={handleContinue}
                  disabled={!email || !email.includes("@")}
                >
                  Continue →
                </Button>
              )}

              {emailConfirmed && (
                <>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-sm font-semibold text-textDark">Password</label>
                      <span className="text-xs text-textLight">min. 6 chars</span>
                    </div>
                    <Input.Password
                      size="large"
                      variant="filled"
                      autoFocus
                      autoComplete="new-password"
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={e => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-textDark">Confirm password</label>
                    <Input.Password
                      size="large"
                      variant="filled"
                      autoComplete="new-password"
                      placeholder="Re-enter password"
                      value={confirm}
                      onChange={e => {
                        setConfirm(e.target.value);
                        setError(null);
                      }}
                      onPressEnter={handleSignup}
                      disabled={submitting}
                    />
                  </div>
                  <Button
                    block
                    type="primary"
                    size="large"
                    loading={submitting}
                    onClick={handleSignup}
                    disabled={!password || !confirm}
                  >
                    Create account →
                  </Button>
                </>
              )}

              {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

              <p className="text-center text-xs text-textLight">
                By signing up, you agree to our{" "}
                <a
                  className="underline hover:text-primary"
                  href="https://jitsu.com/tos"
                  target="_blank"
                  rel="noreferrer"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  className="underline hover:text-primary"
                  href="https://jitsu.com/privacy"
                  target="_blank"
                  rel="noreferrer"
                >
                  Privacy Policy
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

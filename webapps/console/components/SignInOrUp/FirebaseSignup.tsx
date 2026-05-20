import React, { ReactNode, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Alert, Button, Input } from "antd";
import { GithubOutlined } from "@ant-design/icons";
import { branding } from "../../lib/branding";
import { useFirebaseSession } from "../../lib/firebase-client";
import { safeRedirect } from "../../lib/auth-redirect";
import { useJitsu } from "@jitsu/jitsu-react";
import { AuthType, handleFirebaseError } from "./SignInOrUp";
import { useQueryStringCopy } from "./use-query-string-copy";

/** Full-colour Google "G" mark for the OAuth button. */
const GoogleG: React.FC = () => (
  <svg viewBox="0 0 48 48" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
    <path
      fill="#4285F4"
      d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
    />
    <path
      fill="#34A853"
      d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
    />
    <path
      fill="#FBBC05"
      d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
    />
    <path
      fill="#EA4335"
      d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
    />
  </svg>
);

const panelFeatures = [
  {
    title: "Jitsu Functions",
    href: "https://jitsu.com/features/functions",
    description: "Transform, enrich, and route events in-flight with TypeScript — call APIs, persist state.",
  },
  {
    title: "Real-time streaming",
    href: "https://jitsu.com/features/event-streaming",
    description: "Land events in your warehouse the moment they happen.",
  },
  {
    title: "Drop-in for Segment",
    href: "https://jitsu.com/features/segment-compatibility",
    description: "Same SDK shape — keep your existing instrumentation.",
  },
];

const customers = ["Investing.com", "PandaDoc", "Rarible", "Census", "Embeddables"];

/** Syntax-coloured token helpers for the code sample. */
const Kw: React.FC<{ children: ReactNode }> = ({ children }) => <span className="text-[#c792ea]">{children}</span>;
const Fn: React.FC<{ children: ReactNode }> = ({ children }) => <span className="text-[#82aaff]">{children}</span>;

/** Left-hand testimonial / proof panel. Hidden below `lg`. */
const MarketingPanel: React.FC = () => (
  <div
    className="hidden lg:flex lg:w-1/2 p-10 xl:p-14 text-white overflow-y-auto"
    style={{ background: "linear-gradient(155deg, #1c1640 0%, #2a1b53 55%, #211a48 100%)" }}
  >
    {/* one column — every section shares the testimonial's width */}
    <div className="flex w-full max-w-xl flex-col justify-between gap-9">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7">{branding.logo}</div>
          <span className="text-xl font-bold tracking-tight">jitsu</span>
        </div>
        <a href="https://jitsu.com" className="text-sm text-white/55 hover:text-white transition-colors">
          ‹ Back to jitsu.com
        </a>
      </div>

      {/* testimonial */}
      <div>
        <div className="font-serif text-[80px] leading-[0.6] text-white/25">“</div>
        <p className="mt-5 text-2xl xl:text-3xl font-medium leading-snug">
          Jitsu Functions let us enrich events server-side with external APIs and a persistent KV store —{" "}
          <span className="text-white/45">killing the client-side code duplication across web, iOS, and Android.</span>
        </p>
        <div className="mt-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-semibold"
              style={{ background: "linear-gradient(135deg, #a855f7, #7c3aed)" }}
            >
              YA
            </div>
            <div>
              <div className="font-semibold">Yonatan Adest</div>
              <div className="text-sm text-white/55">CTO · Investing.com</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold leading-none">5B</div>
            <div className="mt-1 text-[10px] tracking-[0.2em] text-white/50">EVENTS / MONTH</div>
          </div>
        </div>
      </div>

      {/* cards */}
      <div className="flex gap-4">
        <div
          className="flex-[2] min-w-0 rounded-xl border border-white/10 overflow-hidden"
          style={{ background: "#0e0d18" }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
            <div className="flex items-center gap-2 font-mono text-xs text-white/60">
              <span className="h-2 w-2 rounded-full bg-green-400" />
              enrich.ts
            </div>
            <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] tracking-[0.15em] text-white/40">
              JITSU FUNCTION
            </span>
          </div>
          <div className="p-4 font-mono text-[11px] leading-[1.8] whitespace-pre text-slate-200 overflow-x-auto">
            <div>
              <Kw>export default async function</Kw>
              {" (event, { store, fetch }) {"}
            </div>
            <div>
              {"  "}
              <Kw>const</Kw>
              {" geo = "}
              <Kw>await</Kw>
              {" store."}
              <Fn>get</Fn>
              {"(event.ip)"}
            </div>
            <div>
              {"    ?? "}
              <Kw>await</Kw> <Fn>fetch</Fn>
              {"("}
              <span className="text-[#c3e88d]">{"`/geo/${event.ip}`"}</span>
              {");"}
            </div>
            <div>{"  event.properties.country = geo.country;"}</div>
            <div>
              {"  "}
              <Kw>return</Kw>
              {" event;"}
            </div>
            <div>{"}"}</div>
          </div>
        </div>
        <div className="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col">
          <div className="text-[10px] tracking-[0.18em] text-white/45">TIME TO FIRST EVENT</div>
          <div className="mt-auto pt-6">
            <span className="text-4xl font-bold">43</span>
            <span className="ml-1 text-sm text-white/55">sec</span>
          </div>
        </div>
      </div>

      {/* features */}
      <div className="grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
        {panelFeatures.map(f => (
          <div key={f.title}>
            <a
              href={f.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-semibold hover:underline"
            >
              <span className="text-[#c3e88d]">✓</span>
              {f.title}
            </a>
            <p className="mt-1.5 text-sm text-white/55">{f.description}</p>
          </div>
        ))}
      </div>

      {/* social proof */}
      <div className="border-t border-white/10 pt-6">
        <div className="text-[10px] tracking-[0.18em] text-white/40">IN PRODUCTION AT</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-white/80">
          {customers.map((c, i) => (
            <React.Fragment key={c}>
              {i > 0 && <span className="text-white/25">·</span>}
              <span>{c}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
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
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<AuthType | null>(null);

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
    setOauthLoading(provider);
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
    } finally {
      setOauthLoading(null);
    }
  };

  return (
    <div className="flex min-h-screen">
      <MarketingPanel />

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

            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button
                size="large"
                icon={<GoogleG />}
                loading={oauthLoading === "firebase-google"}
                disabled={!!oauthLoading}
                onClick={() => handleSSOLogin("firebase-google")}
              >
                Continue with Google
              </Button>
              <Button
                size="large"
                icon={<GithubOutlined />}
                loading={oauthLoading === "firebase-github"}
                disabled={!!oauthLoading}
                onClick={() => handleSSOLogin("firebase-github")}
              >
                Continue with GitHub
              </Button>
            </div>

            <div className="my-6 flex items-center gap-3 text-[11px] tracking-[0.18em] text-textLight">
              <div className="h-px flex-1 bg-backgroundDark" />
              OR WITH EMAIL
              <div className="h-px flex-1 bg-backgroundDark" />
            </div>

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
                  <p className="text-center text-xs text-textLight">
                    By creating an account, you agree to our{" "}
                    <a
                      className="underline hover:text-primary"
                      href="https://jitsu.com/tos"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Terms
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
                </>
              )}

              {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Alert, Button, Divider, Input } from "antd";
import { branding } from "../../lib/branding";
import { useFirebaseSession } from "../../lib/firebase-client";
import { safeRedirect } from "../../lib/auth-redirect";
import { useJitsu } from "@jitsu/jitsu-react";
import { OAuthButtons } from "./OAuthButtons";
import { AuthType, handleFirebaseError } from "./SignInOrUp";
import { useQueryStringCopy } from "./use-query-string-copy";

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

const snippets = [
  {
    file: "enrich.ts",
    badge: "JITSU FUNCTION",
    code: `export default async function (event, { store }) {
  const geo = await store.get(event.ip);
  event.country = geo?.country ?? "unknown";
  return event;
}`,
  },
  {
    file: "track.ts",
    badge: "BROWSER SDK",
    code: `import { jitsuAnalytics } from "@jitsu/js";

const jitsu = jitsuAnalytics({ writeKey: "KEY" });
jitsu.identify("user_42", { email });
jitsu.track("Signup Completed", { plan: "pro" });`,
  },
];

// Tiny token highlighter for the (fixed, trusted) code samples — keeps the
// snippets as plain strings instead of hand-written colored JSX.
const CODE_TOKEN =
  /(`[^`]*`|"[^"]*"|'[^']*'|\b(?:import|from|export|default|async|function|const|await|return|new)\b)/g;
const KEYWORD = /^(?:import|from|export|default|async|function|const|await|return|new)$/;

function highlightLine(line: string): ReactNode {
  if (line === "") {
    return " ";
  }
  return line.split(CODE_TOKEN).map((part, i) => {
    if (!part) {
      return null;
    }
    if (part[0] === "`" || part[0] === '"' || part[0] === "'") {
      return (
        <span key={i} className="text-[#c3e88d]">
          {part}
        </span>
      );
    }
    if (KEYWORD.test(part)) {
      return (
        <span key={i} className="text-[#c792ea]">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Code card that auto-cycles through the snippets like switching tabs. */
const CodeShowcase: React.FC = () => {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive(a => (a + 1) % snippets.length), 4500);
    return () => clearInterval(t);
  }, []);
  const snippet = snippets[active];
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: "#0e0d18" }}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          {snippets.map((s, i) => (
            <span key={s.file} className={i === active ? "text-white" : "text-white/30"}>
              {s.file}
            </span>
          ))}
        </div>
        <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] tracking-[0.15em] text-white/40">
          {snippet.badge}
        </span>
      </div>
      <div className="whitespace-pre overflow-x-auto p-4 font-mono text-[12px] leading-[1.7] text-slate-200">
        {snippet.code.split("\n").map((line, i) => (
          <div key={i}>{highlightLine(line)}</div>
        ))}
      </div>
    </div>
  );
};

/** Left-hand testimonial / proof panel. Hidden below `lg`. */
const MarketingPanel: React.FC = () => (
  <div
    className="hidden lg:flex lg:w-1/2 p-10 xl:p-14 text-white overflow-y-auto"
    style={{ background: "linear-gradient(155deg, #1c1640 0%, #2a1b53 55%, #211a48 100%)" }}
  >
    {/* one column — every section shares the same width */}
    <div className="flex w-full max-w-2xl flex-col justify-between gap-9">
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

      {/* code showcase */}
      <CodeShowcase />

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

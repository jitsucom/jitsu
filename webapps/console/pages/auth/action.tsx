import React, { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Alert, Button, Input, Spin } from "antd";
import { getErrorMessage } from "juava";
import { SigninLayout } from "../../components/SignInOrUp/SignInOrUp";
import { useFirebaseSession } from "../../lib/firebase-client";

export async function getServerSideProps() {
  return { props: { publicPage: true } };
}

/**
 * Custom Firebase email-action handler. Firebase's `callbackUri` points here, so
 * verification / password-reset / email-recovery links land in the console
 * instead of Firebase's bare hosted page — and we can redirect into the app once
 * the action completes. See JITSU-018.
 */
type ActionState =
  | { status: "working" }
  | { status: "verified" }
  | { status: "recovered" }
  | { status: "reset-form"; email: string }
  | { status: "reset-done" }
  | { status: "error"; message: string };

function explainActionError(e: any): string {
  switch (e?.code) {
    case "auth/expired-action-code":
      return "This link has expired. Request a new email and try again.";
    case "auth/invalid-action-code":
      return "This link is invalid or has already been used.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
      return "No account was found for this link.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    default:
      return getErrorMessage(e);
  }
}

const REDIRECT_DELAY_MS = 2500;

const AuthActionPage = () => {
  const router = useRouter();
  const firebaseSession = useFirebaseSession();
  const [state, setState] = useState<ActionState>({ status: "working" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const mode = typeof router.query.mode === "string" ? router.query.mode : undefined;
  const oobCode = typeof router.query.oobCode === "string" ? router.query.oobCode : undefined;

  // Apply the action code once the route query is available.
  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    if (!mode || !oobCode) {
      setState({ status: "error", message: "This link is missing required parameters." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (mode === "verifyEmail") {
          await firebaseSession.applyActionCode(oobCode);
          if (!cancelled) setState({ status: "verified" });
        } else if (mode === "recoverEmail") {
          await firebaseSession.applyActionCode(oobCode);
          if (!cancelled) setState({ status: "recovered" });
        } else if (mode === "resetPassword") {
          const email = await firebaseSession.verifyPasswordResetCode(oobCode);
          if (!cancelled) setState({ status: "reset-form", email });
        } else {
          if (!cancelled) setState({ status: "error", message: `Unsupported action: ${mode}` });
        }
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: explainActionError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, mode, oobCode]);

  // Once the action is done, send the user to sign in.
  useEffect(() => {
    if (state.status === "verified" || state.status === "recovered" || state.status === "reset-done") {
      const t = setTimeout(() => router.replace("/signin"), REDIRECT_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [state.status, router]);

  const submitNewPassword = async () => {
    if (state.status !== "reset-form" || !oobCode) {
      return;
    }
    if (password.length < 6) {
      setFormError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords do not match");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await firebaseSession.confirmPasswordReset(oobCode, password);
      setState({ status: "reset-done" });
    } catch (e) {
      setFormError(explainActionError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (state.status === "working") {
    return (
      <SigninLayout title={<div className="text-2xl">One moment…</div>}>
        <div className="max-w-[350px] flex justify-center py-4">
          <Spin size="large" />
        </div>
      </SigninLayout>
    );
  }

  if (state.status === "reset-form") {
    return (
      <SigninLayout title={<div className="text-2xl">Set a new password</div>}>
        <div className="max-w-[350px]">
          <p className="text-textLight">
            Choose a new password for <span className="font-bold">{state.email}</span>.
          </p>
          <div className="mt-4 space-y-3">
            <Input.Password
              size="large"
              autoFocus
              autoComplete="new-password"
              placeholder="New password (min 6 characters)"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                setFormError(null);
              }}
            />
            <Input.Password
              size="large"
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={e => {
                setConfirm(e.target.value);
                setFormError(null);
              }}
              onPressEnter={submitNewPassword}
            />
            {formError && <Alert type="error" message={formError} />}
            <Button block type="primary" size="large" loading={submitting} onClick={submitNewPassword}>
              Update password
            </Button>
          </div>
        </div>
      </SigninLayout>
    );
  }

  const screens: Record<"verified" | "recovered" | "reset-done" | "error", { title: string; body: ReactNode }> = {
    verified: { title: "Email verified", body: "Your email address is verified. Taking you to sign in…" },
    recovered: { title: "Email change reverted", body: "Your sign-in email has been restored. Taking you to sign in…" },
    "reset-done": { title: "Password updated", body: "Your password has been changed. Taking you to sign in…" },
    error: { title: "Link problem", body: state.status === "error" ? state.message : "" },
  };
  const screen = screens[state.status];

  return (
    <SigninLayout
      title={<div className="text-2xl">{screen.title}</div>}
      footer={
        <div className="text-center mt-4">
          <Link className="font-bold text-primary" href="/signin">
            Go to sign in →
          </Link>
        </div>
      }
    >
      <div className="max-w-[350px]">
        {state.status === "error" ? (
          <Alert type="error" message={screen.body} />
        ) : (
          <p className="text-textLight">{screen.body}</p>
        )}
      </div>
    </SigninLayout>
  );
};

export default AuthActionPage;

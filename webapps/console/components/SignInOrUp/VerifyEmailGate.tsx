import React, { useState } from "react";
import { Alert, Button } from "antd";
import { useRouter } from "next/router";
import { getErrorMessage } from "juava";
import { SigninLayout } from "./SignInOrUp";
import { useFirebaseSession } from "../../lib/firebase-client";

type Feedback = { type: "success" | "error"; message: string };

/**
 * Shown by the Firebase authorizer (JITSU-018) when an email+password account
 * signs in before verifying its email address. The user cannot reach the app
 * until the address is verified; from here they can re-send the verification
 * email, re-check the status, or sign out.
 */
export const VerifyEmailGate: React.FC<{ email: string }> = ({ email }) => {
  const router = useRouter();
  const firebaseSession = useFirebaseSession();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);

  const resend = async () => {
    setResending(true);
    setFeedback(null);
    try {
      await firebaseSession.sendVerificationEmail();
      setFeedback({
        type: "success",
        message: `Verification email sent to ${email}. Check your inbox and spam folder.`,
      });
    } catch (e: any) {
      const message =
        e?.code === "auth/too-many-requests"
          ? "Too many requests. Please wait a few minutes before requesting another email."
          : `Failed to send verification email: ${getErrorMessage(e)}`;
      setFeedback({ type: "error", message });
    } finally {
      setResending(false);
    }
  };

  const recheck = async () => {
    setChecking(true);
    setFeedback(null);
    try {
      const verified = await firebaseSession.reloadEmailVerified();
      if (verified) {
        // Re-mount the authorizer so it resolves the now-verified user.
        window.location.reload();
      } else {
        setFeedback({
          type: "error",
          message: "Your email still looks unverified. Click the link in the email, then try again.",
        });
      }
    } catch (e) {
      setFeedback({ type: "error", message: `Could not refresh verification status: ${getErrorMessage(e)}` });
    } finally {
      setChecking(false);
    }
  };

  const signOut = async () => {
    try {
      await firebaseSession.signOut();
    } finally {
      router.push("/signin");
    }
  };

  return (
    <SigninLayout
      title={<div className="text-2xl">Verify your email</div>}
      footer={
        <div className="text-center mt-4">
          Wrong account?{" "}
          <Button type="link" className="font-bold p-0" onClick={signOut}>
            Sign out
          </Button>
        </div>
      }
    >
      <div className="max-w-[350px]">
        <p className="text-textLight">
          We sent a verification link to <span className="font-bold">{email}</span>. Open that email and click the link,
          then continue.
        </p>
        {feedback && (
          <div className="mt-4">
            <Alert type={feedback.type} message={feedback.message} closable onClose={() => setFeedback(null)} />
          </div>
        )}
        <div className="flex flex-col gap-2 mt-6">
          <Button type="primary" loading={checking} onClick={recheck}>
            {"I've verified my email — continue"}
          </Button>
          <Button loading={resending} onClick={resend}>
            Resend verification email
          </Button>
        </div>
      </div>
    </SigninLayout>
  );
};

import React, { useEffect, useState } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { Alert, Button } from "antd";
import { GoogleOutlined } from "@ant-design/icons";
import { getFirebaseClientConfig, resolveAdmin } from "../lib/admin-guard";
import { isFirebaseEnabled } from "../lib/firebase-auth";
import { firebaseSignOut, signInWithGoogle } from "../lib/firebase-client";

type LoginProps = {
  firebaseEnabled: boolean;
  firebaseConfig: Record<string, any> | null;
};

export const getServerSideProps: GetServerSideProps<LoginProps> = async ctx => {
  const admin = await resolveAdmin(ctx.req);
  if (admin) {
    return { redirect: { destination: "/", permanent: false } };
  }
  return {
    props: {
      firebaseEnabled: isFirebaseEnabled(),
      firebaseConfig: getFirebaseClientConfig(),
    },
  };
};

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function Login({ firebaseEnabled, firebaseConfig }: LoginProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(
    router.query.forbidden ? "Your account is not authorized to access this app." : undefined
  );

  // After logout we land here with ?loggedOut=1 — clear the Firebase client
  // state too, so the next sign-in shows the account picker.
  useEffect(() => {
    if (router.query.loggedOut && firebaseConfig) {
      firebaseSignOut(firebaseConfig).catch(() => {});
    }
  }, [router.query.loggedOut, firebaseConfig]);

  const onSignIn = async () => {
    if (!firebaseConfig) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const user = await signInWithGoogle(firebaseConfig);
      const idToken = await user.getIdToken();
      const csrfToken = randomToken();
      document.cookie = `fb-csrfToken=${csrfToken}; path=/; SameSite=Lax`;
      const resp = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, csrfToken }),
      });
      if (resp.ok) {
        window.location.href = "/";
        return;
      }
      const body = await resp.json().catch(() => ({}));
      await firebaseSignOut(firebaseConfig).catch(() => {});
      setError(body.error || `Account ${user.email} is not authorized to access this app.`);
    } catch (e: any) {
      setError(e?.message || "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="w-[380px] bg-white rounded-xl border border-neutral-200 p-8">
        <h1 className="text-xl font-semibold text-neutral-900 text-center">Jitsu Admin</h1>
        <p className="text-sm text-neutral-500 text-center mt-1 mb-6">Sign in to continue</p>
        {!firebaseEnabled && (
          <Alert
            type="warning"
            showIcon
            className="mb-4"
            title="Firebase auth is not configured"
            description="Set FIREBASE_AUTH, or FIREBASE_ADMIN + FIREBASE_CLIENT_CONFIG."
          />
        )}
        {error && <Alert type="error" showIcon className="mb-4" title={error} />}
        <Button
          type="primary"
          size="large"
          block
          icon={<GoogleOutlined />}
          loading={loading}
          disabled={!firebaseEnabled || !firebaseConfig}
          onClick={onSignIn}
        >
          Sign in with Google
        </Button>
      </div>
    </div>
  );
}

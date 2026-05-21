import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Alert, Button, Spin } from "antd";
import { GoogleOutlined } from "@ant-design/icons";
import { useAuth } from "../components/AuthProvider";

export default function Login() {
  const auth = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (auth.status === "admin") {
      router.replace("/");
    }
  }, [auth.status, router]);

  const onSignIn = async () => {
    setLoading(true);
    setError(undefined);
    try {
      await auth.signIn();
    } catch (e: any) {
      setError(e?.message || "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  if (auth.status === "loading" || auth.status === "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="w-[380px] bg-white rounded-xl border border-neutral-200 p-8">
        <h1 className="text-xl font-semibold text-neutral-900 text-center">Jitsu Admin</h1>
        <p className="text-sm text-neutral-500 text-center mt-1 mb-6">Sign in to continue</p>
        {auth.status === "forbidden" && (
          <Alert
            type="error"
            showIcon
            className="mb-4"
            title={`${auth.email || "Your account"} is not authorized to access this app.`}
          />
        )}
        {error && <Alert type="error" showIcon className="mb-4" title={error} />}
        <Button type="primary" size="large" block icon={<GoogleOutlined />} loading={loading} onClick={onSignIn}>
          Sign in with Google
        </Button>
      </div>
    </div>
  );
}

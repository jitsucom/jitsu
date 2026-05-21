import React, { PropsWithChildren, useEffect } from "react";
import { useRouter } from "next/router";
import { Button, Spin } from "antd";
import { useAuth } from "./AuthProvider";

const Centered: React.FC<PropsWithChildren> = ({ children }) => (
  <div className="min-h-screen flex items-center justify-center bg-neutral-50">{children}</div>
);

/** Page gate: renders children only for an authorized admin. */
export const RequireAdmin: React.FC<PropsWithChildren> = ({ children }) => {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "anon") {
      router.replace("/login");
    }
  }, [auth.status, router]);

  if (auth.status === "loading" || auth.status === "anon") {
    return (
      <Centered>
        <Spin size="large" />
      </Centered>
    );
  }

  if (auth.status === "forbidden") {
    return (
      <Centered>
        <div className="w-[400px] bg-white rounded-xl border border-neutral-200 p-8 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">Not authorized</h1>
          <p className="text-sm text-neutral-500 mt-2">
            {auth.email || "Your account"} is not allowed to access this app.
          </p>
          <Button className="mt-4" onClick={() => auth.signOut()}>
            Sign in with a different account
          </Button>
        </div>
      </Centered>
    );
  }

  return <>{children}</>;
};

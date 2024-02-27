import { getCsrfToken, signIn, useSession } from "next-auth/react";
import { Redirect } from "../components/Redirect/Redirect";
import { Button, Input } from "antd";
import { useAppConfig } from "../lib/context";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { GithubOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { feedbackError } from "../lib/ui";
import { useRouter } from "next/router";
import { branding } from "../lib/branding";
import { credentialsLoginEnabled, githubLoginEnabled } from "../lib/nextauth.config";
import { useQuery } from "@tanstack/react-query";

function JitsuLogo() {
  return (
    <div className="flex items-center w-fit h-full space-x-2">
      <div className="aspect-square h-full">{branding.logo}</div>
      <div className="text-textDark h-4/6">{branding.wordmark}</div>
    </div>
  );
}



function CredentialsForm({}) {
  const lastUsedLogin = localStorage.getItem("last-used-login-email") || undefined;
  const {
    data,
    isLoading,
    error,
  } = useQuery(["next-auth-csrfToken"], async () => {
    return {
      csrfToken: await getCsrfToken(),
    };
  });
  const loading = isLoading || !!error;
  return (
    <form className="space-y-4" method="post" action={"/api/auth/callback/credentials"}>
      {data?.csrfToken && <input name="csrfToken" type="hidden" defaultValue={data?.csrfToken} />}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700" htmlFor="email">
          Email
        </label>
        <Input
          disabled={loading}
          id="email"
          size="large"
          placeholder="m@example.com"
          required
          type="email"
          name="username"
          value={lastUsedLogin}
          onChange={e => {
            if (e.target.value) {
              localStorage.setItem("last-used-login-email", e.target.value);
            }
          }}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700" htmlFor="password">
          Password
        </label>
        <Input disabled={loading} id="password" size="large" required type="password" name="password" />
      </div>
      <Button htmlType="submit" className="w-full" type="primary" disabled={loading}>
        {loading ? 'Preparing login form...' : 'Sign In'}
      </Button>
    </form>
  );
}

function GitHubSignIn() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Button
        className="w-full"
        icon={<GithubOutlined />}
        loading={loading}
        onClick={async () => {
          try {
            setLoading(true);
            await signIn("github");
            await router.push("/");
          } catch (e: any) {
            feedbackError("Failed to sign in with GitHub", e);
          } finally {
            setLoading(false);
          }
        }}
      >
        Sign in with GitHub
      </Button>
    </div>
  );
}

const NextAuthSignInPage = ({ csrfToken, providers: { github, credentials } }) => {
  const router = useRouter();
  const nextAuthSession = useSession();
  const app = useAppConfig();
  if (nextAuthSession.status === "authenticated") {
    return <Redirect href={"/"} />;
  }
  if (app.auth?.firebasePublic) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center">
        <AlertTriangle className="w-32 h-32 text-error" />
        <div className="mt-3 text-textLight text-center">
          This page should not be used if Firebase authorization is enabled. Please proceed to a{" "}
          <Link href="/" className="underline text-primary">
            main page of the app
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[350px] space-y-6 pt-12">
      <div className="space-y-2 flex justify-center h-16">
        <JitsuLogo />
      </div>
      <div>
        {credentials.enabled && <CredentialsForm />}
        {credentials.enabled && github.enabled && <hr className="my-8" />}
        {github.enabled && <GitHubSignIn />}
      </div>
      {router.query.error && (
        <div className="text-error">
          Something went wrong. Please try again. Error code: <code>{router.query.error}</code>
        </div>
      )}
      {!app.disableSignup && github.enabled && (
        <div className="text-center text-textLight text-xs">
          Automatic signup is enabled for this instance. Sign in with github and if you don't have an account, a new
          account will be created automatically. This account won't have any access to pre-existing project unless the
          access is explicitly granted
        </div>
      )}
    </div>
  );
};

export async function getServerSideProps(context) {
  if (process.env.FIREBASE_AUTH) {
    throw new Error(`Firebase auth is enabled. This page should not be used.`);
  }
  if (!githubLoginEnabled && !credentialsLoginEnabled) {
    throw new Error(`No auth providers are enabled found. Available providers: github, credentials`);
  }
  return {
    props: {
      providers: {
        credentials: {
          enabled: credentialsLoginEnabled,
          callbackUrl: "/api/auth/callback/credentials",
        },
        github: {
          enabled: githubLoginEnabled,
        },
      },
      publicPage: true,
    },
  };
}

export default NextAuthSignInPage;

import React, { ReactNode, useState } from "react";
import { Button } from "antd";
import { GithubOutlined, GoogleOutlined, KeyOutlined } from "@ant-design/icons";
import { getLog } from "juava";
import { AuthType } from "./SignInOrUp";

const log = getLog("oauth-buttons");

type OAuthProvider = "firebase-google" | "firebase-github" | "nextauth-github" | "nextauth-oidc";

interface OAuthButtonsProps {
  providers?: Array<OAuthProvider>;
  prefix?: string;
  onSSOLogin: (type: AuthType, providerId: string) => Promise<void>;
  // Optional badge floated over the top of a specific provider's button (e.g.
  // the work-email hint on "Continue with Google" — JITSU-70).
  notes?: Partial<Record<OAuthProvider, ReactNode>>;
}

export const OAuthButtons: React.FC<OAuthButtonsProps> = ({
  providers = ["firebase-google", "firebase-github", "nextauth-github", "nextauth-oidc"],
  prefix = "Sign in",
  onSSOLogin,
  notes,
}) => {
  const [loading, setLoading] = useState<string | undefined>();

  const handleLogin = async (provider: AuthType) => {
    try {
      setLoading(provider);
      await onSSOLogin(provider, provider);
    } finally {
      setLoading(undefined);
    }
  };

  // Float the note as a small badge over the button's top-right corner. It's a
  // sibling of the button (not a child), so it doesn't intercept the button's
  // click — and it stays interactive so a tooltip on it works.
  const withBadge = (provider: OAuthProvider, button: ReactNode) => {
    const note = notes?.[provider];
    if (!note) {
      return button;
    }
    return (
      <div key={provider} className="relative flex">
        {button}
        <div className="absolute -right-1.5 -top-1.5 z-10">{note}</div>
      </div>
    );
  };

  const renderButton = (provider: string) => {
    switch (provider) {
      case "firebase-google":
        return withBadge(
          "firebase-google",
          <Button
            key={provider}
            loading={loading === "firebase-google"}
            disabled={!!loading}
            size="large"
            icon={<GoogleOutlined />}
            onClick={() => handleLogin("firebase-google")}
          >
            {prefix} with Google
          </Button>
        );
      case "firebase-github":
        return withBadge(
          "firebase-github",
          <Button
            key={provider}
            size="large"
            icon={<GithubOutlined />}
            loading={loading === "firebase-github"}
            disabled={!!loading}
            onClick={() => handleLogin("firebase-github")}
          >
            {prefix} with GitHub
          </Button>
        );
      case "nextauth-github":
        return withBadge(
          "nextauth-github",
          <Button
            key={provider}
            size="large"
            icon={<GithubOutlined />}
            loading={loading === "nextauth-github"}
            disabled={!!loading}
            onClick={() => handleLogin("nextauth-github")}
          >
            {prefix} with GitHub
          </Button>
        );
      case "nextauth-oidc":
        return withBadge(
          "nextauth-oidc",
          <Button
            key={provider}
            size="large"
            icon={<KeyOutlined />}
            loading={loading === "nextauth-oidc"}
            disabled={!!loading}
            onClick={() => handleLogin("nextauth-oidc")}
          >
            {prefix} with SSO
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="pt-0 sm:pt-6 flex flex-col sm:flex-row space-y-2 sm:space-x-2 sm:space-y-0 justify-between">
        {providers.map(renderButton)}
      </div>
    </div>
  );
};

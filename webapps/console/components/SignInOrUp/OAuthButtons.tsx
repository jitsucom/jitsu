import React, { useState } from "react";
import { Button } from "antd";
import { GithubOutlined, GoogleOutlined, KeyOutlined } from "@ant-design/icons";
import { getLog } from "juava";
import { AuthType } from "./SignInOrUp";

const log = getLog("oauth-buttons");

interface OAuthButtonsProps {
  providers?: Array<"firebase-google" | "firebase-github" | "nextauth-github" | "nextauth-oidc">;
  prefix?: string;
  onSSOLogin: (type: AuthType, providerId: string) => Promise<void>;
}

export const OAuthButtons: React.FC<OAuthButtonsProps> = ({
  providers = ["firebase-google", "firebase-github", "nextauth-github", "nextauth-oidc"],
  prefix = "Sign in",
  onSSOLogin,
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

  const renderButton = (provider: string) => {
    switch (provider) {
      case "firebase-google":
        return (
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
        return (
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
        return (
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
        return (
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

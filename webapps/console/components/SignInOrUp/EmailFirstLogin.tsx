import React, { useState } from "react";
import { Alert, Button, Input, Spin } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { rpc } from "juava";
import { useRouter } from "next/router";
import { signIn } from "next-auth/react";

type AuthMethod = {
  type: "firebase-password" | "firebase-google" | "firebase-github" | "oidc" | "none";
  oidcProviderId?: string;
  oidcProviderName?: string;
};

interface EmailFirstLoginProps {
  onPasswordLogin: (email: string, password: string) => Promise<void>;
  onSocialLogin: (type: string) => Promise<void>;
  onOidcLogin?: (providerId: string) => Promise<void>;
}

const handleOidcRedirect = async (providerId: string, email: string) => {
  // Redirect to the dynamic OIDC authorization endpoint
  window.location.href = `/api/auth/dynamic-oidc/authorize?providerId=${providerId}`;
};

export const EmailFirstLogin: React.FC<EmailFirstLoginProps> = ({ onPasswordLogin, onSocialLogin, onOidcLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const router = useRouter();

  const checkAuthMethod = async () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setCheckingEmail(true);
    setError(null);

    try {
      const result = await rpc("/api/auth/check-email", {
        body: { email },
      });

      setAuthMethod(result);

      // Auto-trigger social login if applicable
      if (result.type === "firebase-google") {
        await onSocialLogin("google.com");
      } else if (result.type === "firebase-github") {
        await onSocialLogin("github.com");
      } else if (result.type === "oidc" && result.oidcProviderId) {
        // Directly redirect to OIDC provider
        await handleOidcRedirect(result.oidcProviderId, email);
      }
    } catch (err: any) {
      setError("Failed to check authentication method. Please try again.");
      console.error("Error checking auth method:", err);
    } finally {
      setCheckingEmail(false);
    }
  };

  const handlePasswordLogin = async () => {
    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onPasswordLogin(email, password);
      // Redirect will be handled by parent component
    } catch (err: any) {
      setError(err.message || "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const renderAuthForm = () => {
    if (!authMethod) {
      return null;
    }

    switch (authMethod.type) {
      case "firebase-password":
        return (
          <div className="mt-4">
            <div className="font-bold text-textLight tracking-wide pb-2 flex items-center">
              <LockOutlined className="mr-2" />
              Password
            </div>
            <Input.Password
              size="large"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              onPressEnter={handlePasswordLogin}
            />
            <div className="mt-2 text-right">
              <a className="text-sm hover:text-primary" href={`/reset-password?email=${encodeURIComponent(email)}`}>
                Forgot password?
              </a>
            </div>
            <Button className="w-full mt-4" type="primary" size="large" loading={loading} onClick={handlePasswordLogin}>
              Sign in
            </Button>
          </div>
        );

      case "firebase-google":
        return (
          <div className="mt-4">
            <Alert message="Redirecting to Google login..." type="info" showIcon icon={<Spin />} />
          </div>
        );

      case "firebase-github":
        return (
          <div className="mt-4">
            <Alert message="Redirecting to GitHub login..." type="info" showIcon icon={<Spin />} />
          </div>
        );

      case "oidc":
        return (
          <div className="mt-4">
            <Alert
              message={`Redirecting to ${authMethod.oidcProviderName || "SSO provider"}...`}
              type="info"
              showIcon
              icon={<Spin />}
            />
          </div>
        );

      case "none":
        return (
          <div className="mt-4">
            <Alert
              message="No account found"
              description="No account exists for this email address. Please check your email or contact your administrator."
              type="warning"
              showIcon
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="w-full">
      <div className="space-y-4">
        <div>
          <div className="font-bold text-textLight tracking-wide pb-2 flex items-center">
            <MailOutlined className="mr-2" />
            Email
          </div>
          <Input
            size="large"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              setAuthMethod(null);
              setError(null);
            }}
            placeholder="Enter your email address"
            onPressEnter={checkAuthMethod}
            disabled={checkingEmail || loading}
          />
          <div className="mt-2 text-sm text-textLight">Use this for SSO and password based logins</div>
        </div>

        {!authMethod && (
          <Button
            className="w-full"
            type="primary"
            size="large"
            loading={checkingEmail}
            onClick={checkAuthMethod}
            disabled={!email || !email.includes("@")}
          >
            Continue
          </Button>
        )}

        {error && (
          <Alert message="Error" description={error} type="error" showIcon closable onClose={() => setError(null)} />
        )}

        {renderAuthForm()}
      </div>
    </div>
  );
};

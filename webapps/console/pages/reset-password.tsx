import { SigninLayout } from "../components/SignInOrUp/SignIn";
import { Button, Input } from "antd";
import React, { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useAppConfig } from "../lib/context";
import { getFirebaseAuth } from "../lib/firebase-client";
import { feedbackSuccess } from "../lib/ui";
import { EmbeddedErrorMessage } from "../components/GlobalError/GlobalError";

const ResetPassword = () => {
  const appConfig = useAppConfig();
  const router = useRouter();
  const [email, setEmail] = useState<string | undefined>(router?.query.email as any);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [emailSent, setEmailSent] = useState(false);

  if (!appConfig?.auth?.firebasePublic) {
    return (
      <div>
        <div className="mt-12 mx-auto max-w-4xl">
          <EmbeddedErrorMessage>
            Current configuration do not support email-based accounts password reset
          </EmbeddedErrorMessage>
        </div>
        <div className="text-textDark text-center mt-6">
          <Link href={(router.query?.back as any) || "/"} className={"hover:underline"}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SigninLayout title={"Reset Password"}>
      <div className="font-bold text-textLight  tracking-wide pb-0.5">Email</div>
      <div>
        <Input
          placeholder="chandler.bing@example.com"
          size="large"
          onChange={e => setEmail(e.target.value)}
          value={email}
        />
      </div>
      <Button
        className="w-full mt-6"
        size="large"
        type="primary"
        loading={loading}
        disabled={loading || emailSent}
        onClick={async () => {
          const firebaseAuth = getFirebaseAuth({ enable: true, settings: appConfig?.auth?.firebasePublic });
          if (!email) {
            return;
          }
          try {
            setLoading(true);
            await firebaseAuth.sendPasswordResetEmail(firebaseAuth.getAuth(), email);
            feedbackSuccess("Reset email has been set, check you inbox");
            setEmailSent(true);
          } catch (e: any) {
            setError(e?.message || "Uknown error");
          } finally {
            setLoading(false);
          }
        }}
      >
        {email ? "Email has been sent" : "Send reset email"}
      </Button>
      <div className="text-textDark text-center mt-6">
        <Link href={(router.query?.back as any) || "/"} className={"hover:underline"}>
          Back to sign in
        </Link>
      </div>
    </SigninLayout>
  );
};

ResetPassword.getInitialProps = () => {
  return { publicPage: true };
};

export default ResetPassword;

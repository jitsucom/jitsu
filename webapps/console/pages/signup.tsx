import React, { useState } from "react";
import { useRouter } from "next/router";
import { useAppConfig } from "../lib/context";
import { ErrorCard } from "../components/GlobalError/GlobalError";
import { Button } from "antd";
import { SignUp } from "../components/SignInOrUp/SignUp";

const Signup = () => {
  const appConfig = useAppConfig();
  const router = useRouter();
  const [email, setEmail] = useState<string | undefined>(router?.query.email as any);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [emailSent, setEmailSent] = useState(false);

  if (!appConfig?.auth?.firebasePublic) {
    return (
      <div className="mx-12 my-12">
        <ErrorCard title={"Current configuration do not support new user signup"} hideActions={true} />
        <div className="pt-6">
          <Button type="primary" className="text-primary font-bold" href={"/"}>
            Back to main page
          </Button>
        </div>
      </div>
    );
  }

  return <SignUp />;
};

Signup.getInitialProps = () => {
  return { publicPage: true };
};

export default Signup;

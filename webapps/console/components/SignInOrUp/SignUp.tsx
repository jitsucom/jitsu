import { SocialLogin } from "./SignIn";
import React, { useEffect } from "react";
import Link from "next/link";
import { FirebaseProvider, useFirebaseSession } from "../../lib/firebase-client";
import { useAppConfig } from "../../lib/context";
import { ErrorCard } from "../GlobalError/GlobalError";
import { useRouter } from "next/router";
import { useQueryStringCopy } from "./use-query-string-copy";

export const SignUp: React.FC<{}> = () => {
  const appConfig = useAppConfig();

  if (appConfig?.auth?.firebasePublic) {
    return (
      <FirebaseProvider appConfig={appConfig}>
        <FirebaseSignUp />
      </FirebaseProvider>
    );
  } else {
    return <ErrorCard title={"Only firebase supports signup"}></ErrorCard>;
  }
};

export const FirebaseSignUp: React.FC<{}> = () => {
  const firebase = useFirebaseSession();
  const router = useRouter();
  const queryStringCopy = useQueryStringCopy();
  const redirect = (router.query.redirect as string) || "/";
  const invite = (router.query.invite as string) || "";
  useEffect(() => {
    firebase.resolveUser().user.then(user => {
      if (user) {
        router.push(redirect);
      }
    });
  });
  return (
    <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className={"flex flex-col items-center justify-center grow"}>
        <div
          className="bg-backgroundLight p-8 border border-backgroundDark rounded-md shadow-sm mx-4"
          style={{ minWidth: "28rem" }}
        >
          <div className="flex justify-center text-2xl font-header font-bold mb-4">Sign up for Jitsu</div>
          <div>
            <SocialLogin
              prefix="Sign up"
              onSocialLogin={async type => {
                await firebase.signInWith(type);
                if (invite) {
                  router.push(`/accept?invite=${invite}`);
                } else {
                  router.push(redirect);
                }
              }}
            />
          </div>
        </div>
        <div className="mt-4 text-base">
          Already have an account?{" "}
          <Link className="link font-bold" href={`/${queryStringCopy}`}>
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
};

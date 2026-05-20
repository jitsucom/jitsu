import { SignInOrUp } from "../components/SignInOrUp/SignInOrUp";
import { FirebaseSignup } from "../components/SignInOrUp/FirebaseSignup";
import { useAppConfig } from "../lib/context";

const SignUpPage = () => {
  const appConfig = useAppConfig();
  // The marketing-led signup page is Cloud-only (Firebase auth). Self-hosted
  // (NextAuth) signup keeps the plain shared component.
  const useNewSignup = !!appConfig.auth?.firebasePublic && !appConfig.disableSignup;
  return useNewSignup ? <FirebaseSignup /> : <SignInOrUp signup />;
};

export async function getServerSideProps() {
  return {
    props: {
      publicPage: true,
    },
  };
}

export default SignUpPage;

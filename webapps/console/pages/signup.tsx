import { SignInOrUp } from "../components/SignInOrUp/SignInOrUp";

const SignUpPage = () => {
  return <SignInOrUp signup />;
};

export async function getServerSideProps() {
  return {
    props: {
      publicPage: true,
    },
  };
}

export default SignUpPage;

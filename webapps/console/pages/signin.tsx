import { SignInOrUp } from "../components/SignInOrUp/SignInOrUp";

const SignInPage = () => {
  return <SignInOrUp />;
};

export async function getServerSideProps() {
  return {
    props: {
      publicPage: true,
    },
  };
}

export default SignInPage;

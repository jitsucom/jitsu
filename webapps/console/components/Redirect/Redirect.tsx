import { useEffect } from "react";
import { useRouter } from "next/router";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";

export const Redirect: React.FC<{ href: string }> = ({ href }) => {
  const router = useRouter();
  useEffect(() => {
    router.push(href);
  }, []);
  return <LoadingAnimation />;
};

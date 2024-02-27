import { useEffect } from "react";
import { useRouter } from "next/router";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";

export const Redirect: React.FC<{ href: string; title?: string }> = ({ title, href }) => {
  const router = useRouter();
  useEffect(() => {
    router.push(href);
  }, []);
  return <LoadingAnimation title={title ?? `Redirecting...`} />;
};

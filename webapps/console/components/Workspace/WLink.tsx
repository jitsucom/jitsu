import Link from "next/link";
import { LinkProps } from "next/dist/client/link";
import { PropsWithChildren } from "react";
import { useWorkspace } from "../../lib/context";

export type WLinkProps = LinkProps & {
  target?: string;
  rel?: string;
  className?: string;
};

export const WLink: React.FC<PropsWithChildren<WLinkProps>> = ({ href, target, rel, children, ...props }) => {
  const workspace = useWorkspace();
  return (
    <Link target={target} rel={rel} href={`/${workspace.slug || workspace.id}${href}`} {...props}>
      {children}
    </Link>
  );
};

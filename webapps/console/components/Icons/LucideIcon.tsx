import dynamic from "next/dynamic";
import type { LucideProps } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";

interface IconProps extends LucideProps {
  name: keyof typeof dynamicIconImports;
}

const LucideIcon = ({ name, ...props }: IconProps) => {
  const LI = dynamic(dynamicIconImports[name]);

  return <LI {...props} />;
};

export default LucideIcon;

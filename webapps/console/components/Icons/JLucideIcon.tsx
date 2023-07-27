import dynamic from "next/dynamic";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { RefAttributes, SVGAttributes } from "react";

type ComponentAttributes = RefAttributes<SVGSVGElement> & SVGAttributes<SVGSVGElement>;
interface LucideProps extends ComponentAttributes {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}

interface IconProps extends LucideProps {
  name: keyof typeof dynamicIconImports;
}

const JLucideIcon = ({ name, ...props }: IconProps) => {
  const LI = dynamic(dynamicIconImports[name]);

  return <LI {...props} />;
};

export default JLucideIcon;

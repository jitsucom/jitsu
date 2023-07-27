import { icons } from "lucide-react";
import React, { RefAttributes, SVGAttributes } from "react";

type ComponentAttributes = RefAttributes<SVGSVGElement> & SVGAttributes<SVGSVGElement>;
interface LucideProps extends ComponentAttributes {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}

interface IconProps extends LucideProps {
  name: string;
}

const JLucideIcon = ({ name, ...props }: IconProps) => {
  const n = name.replace(/-(.)/g, x => x.substring(1).toUpperCase()).replace(/^(.)/g, c => c.toUpperCase());
  const LucideIcon = icons[n];
  if (!LucideIcon) {
    return <div style={props.style} className={`anticon ${props.className}`}></div>;
  }
  return <LucideIcon {...props} />;
};

export default React.memo(JLucideIcon);

import React, { ReactNode, useEffect, useState } from "react";
import classNames from "classnames";

export function Spinner(props: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={props.className ?? "w-full h-full"}>
      <g>
        <path
          fill="currentColor"
          d="M109.25 55.5h-36l12-12a29.54 29.54 0 0 0-49.53 12H18.75A46.04 46.04 0 0 1 96.9 31.84l12.35-12.34v36zm-90.5 17h36l-12 12a29.54 29.54 0 0 0 49.53-12h16.97A46.04 46.04 0 0 1 31.1 96.16L18.74 108.5v-36z"
        />
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 64 64"
          to="360 64 64"
          dur="1500ms"
          repeatCount="indefinite"
        ></animateTransform>
      </g>
    </svg>
  );
}

export function LoadingAnimation({
  title,
  className,
  hideTitle,
}: {
  title?: ReactNode;
  iconSize?: number;
  fontSize?: string;
  className?: string;
  hideTitle?: boolean;
}) {
  return (
    <div className={classNames("flex flex-col items-center justify-center", className)}>
      <div className="w-12 h-12">
        <Spinner />
      </div>
      {!hideTitle && <div className={`text-text text-lg mt-4`}>{title || "Loading..."}</div>}
    </div>
  );
}

export type GlobalLoaderProps = {
  title?: ReactNode;
};

export const GlobalLoader: React.FC<GlobalLoaderProps> = ({ title }) => {
  const [showAnimation, setShowAnimation] = useState(false);
  useEffect(() => {
    setTimeout(() => setShowAnimation(true), 1000);
  }, []);
  return (
    <div className="absolute top-0 flex justify-center flex-col left-0 m-0 p-0 z-50 overflow-hidden w-screen h-screen">
      <div className="flex justify-center items-center text-primary flex-grow">
        <div className="flex flex-col items-center justify-center">
          {showAnimation && <LoadingAnimation title={title || "Loading..."} />}
        </div>
      </div>
    </div>
  );
};

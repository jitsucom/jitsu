import React, { FC } from "react";
import { ChevronLeft } from "lucide-react";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { useRouter } from "next/router";
import { usePreviousRoute } from "../../lib/previous-route";

type BackButtonProps = {
  href?: string;
  onClick?: () => void;
  useHistory?: boolean;
};

export const BackButton: FC<BackButtonProps> = ({ href, onClick, useHistory }) => {
  const router = useRouter();
  const previousRoute = usePreviousRoute();
  const canUseHistory = !!useHistory && !!previousRoute;

  if (!href && !onClick && !canUseHistory) {
    return <></>;
  }
  return (
    <JitsuButton
      icon={<ChevronLeft className="w-6 h-6" />}
      type="link"
      size="small"
      onClick={() => {
        if (canUseHistory) {
          router.push(previousRoute!);
          return;
        }
        onClick ? onClick() : router.push(href!);
      }}
    >
      Back
    </JitsuButton>
  );
};

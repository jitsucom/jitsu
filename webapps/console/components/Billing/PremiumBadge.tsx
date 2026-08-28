import React from "react";
import { Lock } from "lucide-react";

/**
 * Small "Premium" pill for features that are visible but locked on the current
 * plan (JITSU-202). Show the locked control next to it rather than hiding it —
 * the point is that free users see what an upgrade unlocks.
 */
export const PremiumBadge: React.FC<{ className?: string }> = ({ className }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary ${
      className ?? ""
    }`}
  >
    <Lock className="h-3 w-3" />
    Premium
  </span>
);

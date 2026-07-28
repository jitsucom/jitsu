import React from "react";
import { ArrowRight } from "lucide-react";
import { useWorkspace } from "../../lib/context";
import { WJitsuButton } from "../JitsuButton/JitsuButton";
import segmentIcon from "../../lib/schema/icons/segment";

/** Overview-page teaser for the migration analyzer (JITSU-131). */
export const MigrationTeaserCard: React.FC = () => {
  useWorkspace(); // asserts workspace context; WJitsuButton builds the workspace-relative href
  return (
    <div className="mt-8 border-textDisabled rounded-lg bg-backgroundLight px-4 py-5 flex items-center bg-neutral-50 border border-neutral-200">
      <div className="w-8 h-8 mr-4">{segmentIcon}</div>
      <div>
        <div className="text-xl text pb-2">Migrating from Segment or RudderStack?</div>
        <div className="text pt-2 pb-4 text-textLight">
          Connect your current workspace and get a free migration report: which destinations move automatically, which
          need a small change, and how much you could save. Read-only — nothing is created or changed.
        </div>
        <WJitsuButton href="/import" type="default" icon={<ArrowRight className="w-4 h-4" />}>
          Analyze my workspace
        </WJitsuButton>
      </div>
    </div>
  );
};

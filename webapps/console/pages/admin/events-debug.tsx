import { ReactNode, useState } from "react";
import { Button } from "antd";
import { feedbackError } from "../../lib/ui";
import { useJitsu } from "@jitsu/jitsu-react";

const SendEventButton: React.FC<{ children: ReactNode; onClick: () => Promise<void> }> = ({ children, onClick }) => {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      size="large"
      loading={loading}
      onClick={async () => {
        try {
          setLoading(true);
          await onClick();
        } catch (e: any) {
          feedbackError(e);
        } finally {
          setLoading(false);
        }
      }}
    >
      {children}
    </Button>
  );
};

export default function TrackingEventsDebugger() {
  const { analytics } = useJitsu();
  return (
    <div className="h-screen w-screen flex flex-col gap-4 items-center justify-center">
      <SendEventButton
        onClick={async () => {
          await analytics.track("sign_up");
        }}
      >
        Sign Up
      </SendEventButton>
      <SendEventButton
        onClick={async () => {
          await analytics.track("login");
        }}
      >
        Login
      </SendEventButton>
    </div>
  );
}

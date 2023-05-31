import { ButtonProps } from "antd/lib/button/button";
import { useState } from "react";
import { Button } from "antd";
import { feedbackError, feedbackSuccess } from "../../lib/ui";

export type AsyncButtonProps = ButtonProps & {
  onClick: () => Promise<void>;
  errorMessage?: string;
  successMessage?: string;
  onSuccess?: () => void;
  onError?: (e: any) => void;
};
export const AsyncButton: React.FC<AsyncButtonProps> = props => {
  const { onClick, ...rest } = props;
  const [loading, setLoading] = useState(false);
  return (
    <Button
      {...rest}
      loading={loading}
      onClick={async () => {
        try {
          setLoading(true);
          await onClick();
          if (props.successMessage) {
            feedbackSuccess(props.successMessage);
          }
          if (props.onSuccess) {
            props.onSuccess();
          }
        } catch (e) {
          feedbackError(props.errorMessage || "Action failed", { error: e });
          if (props.onError) {
            props.onError(e);
          }
        } finally {
          setLoading(false);
        }
      }}
    >
      {props.children}
    </Button>
  );
};

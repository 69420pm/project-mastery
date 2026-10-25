import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Why a reply failed, with Retry to ask for it again. */
export function ReplyError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcwIcon />
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}

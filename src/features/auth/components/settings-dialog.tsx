"use client";

import { useTheme } from "next-themes";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DailyLimitRow } from "@/features/auth/components/daily-limit-row";
import { saveDisplayName } from "@/features/auth/server/actions";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string | null;
  email: string | undefined;
};

/** The Student's settings: name, email and appearance. */
export function SettingsDialog({
  open,
  onOpenChange,
  displayName,
  email,
}: SettingsDialogProps) {
  const { theme, setTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  function save(formData: FormData) {
    setSaved(false);
    startTransition(async () => {
      const result = await saveDisplayName(formData);
      setError(result.ok ? undefined : result.message);
      setSaved(result.ok);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Your account and how the app looks.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <form action={save} className="flex flex-col gap-2">
            <Field>
              <FieldLabel htmlFor="settings-name">Name</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="settings-name"
                  name="displayName"
                  defaultValue={displayName ?? ""}
                  maxLength={100}
                  autoComplete="name"
                  aria-invalid={error ? true : undefined}
                />
                <Button type="submit" disabled={pending}>
                  Save
                </Button>
              </div>
              {error && <FieldError>{error}</FieldError>}
              {saved && !error && (
                <p role="status" className="text-sm text-muted-foreground">
                  Saved.
                </p>
              )}
            </Field>
          </form>
          <Field>
            <FieldLabel htmlFor="settings-email">Email</FieldLabel>
            <Input id="settings-email" value={email ?? ""} readOnly />
          </Field>
          {open && <DailyLimitRow />}
          <Field>
            <FieldLabel htmlFor="settings-theme">Appearance</FieldLabel>
            <Select value={theme ?? "system"} onValueChange={setTheme}>
              <SelectTrigger id="settings-theme" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

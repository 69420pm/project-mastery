"use client";

import { PaletteIcon, UserIcon, GaugeIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyLimitRow } from "@/features/auth/components/daily-limit-row";
import { saveDisplayName } from "@/features/auth/server/actions";

export type SettingsSection = "account" | "appearance" | "usage";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  displayName: string | null;
  email: string | undefined;
};

/** The Student's settings, in sections: account, appearance and usage. */
export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
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
      <DialogContent className="h-[min(36rem,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogDescription className="sr-only">
          Your account, how the app looks and your usage.
        </DialogDescription>
        <Tabs
          value={section}
          onValueChange={(value) => onSectionChange(value as SettingsSection)}
          orientation="vertical"
          className="h-full min-h-0 flex-col gap-0 sm:flex-row"
        >
          <div className="flex shrink-0 flex-col gap-3 border-b bg-muted/40 p-3 sm:w-56 sm:border-r sm:border-b-0 sm:p-4">
            <DialogTitle className="px-1 text-base font-medium">
              Settings
            </DialogTitle>
            <TabsList
              variant="line"
              className="w-full flex-row gap-1 sm:flex-col"
            >
              <TabsTrigger value="account" className="py-1.5 sm:h-9">
                <UserIcon />
                Account
              </TabsTrigger>
              <TabsTrigger value="appearance" className="py-1.5 sm:h-9">
                <PaletteIcon />
                Appearance
              </TabsTrigger>
              <TabsTrigger value="usage" className="py-1.5 sm:h-9">
                <GaugeIcon />
                Usage
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <TabsContent value="account" className="flex flex-col gap-4">
              <h3 className="text-base font-medium">Account</h3>
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
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Email</span>
                <p className="text-sm text-muted-foreground">{email ?? ""}</p>
              </div>
            </TabsContent>
            <TabsContent value="appearance" className="flex flex-col gap-4">
              <h3 className="text-base font-medium">Appearance</h3>
              <Field>
                <FieldLabel htmlFor="settings-theme">Theme</FieldLabel>
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
            </TabsContent>
            <TabsContent value="usage" className="flex flex-col gap-4">
              <h3 className="text-base font-medium">Usage</h3>
              {open && <DailyLimitRow />}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  SettingsDialog,
  type SettingsSection,
} from "@/features/auth/components/settings-dialog";

const OpenSettingsContext = createContext<(() => void) | null>(null);

/** Opens the Settings dialog. Only valid under `SettingsProvider`. */
export function useOpenSettings() {
  const open = useContext(OpenSettingsContext);
  if (!open) throw new Error("useOpenSettings needs a SettingsProvider");
  return open;
}

type SettingsProviderProps = {
  email: string | undefined;
  /** The Student's name, or null while none is set. */
  displayName: string | null;
  children: ReactNode;
};

/**
 * Holds the Settings dialog and its section above the sidebar. The sidebar
 * swaps its children between the desktop layout and the phone slide-over
 * when the window crosses 768 px, which would reset the dialog if it lived
 * in the account menu.
 */
export function SettingsProvider({
  email,
  displayName,
  children,
}: SettingsProviderProps) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("account");
  const openSettings = useMemo(() => () => setOpen(true), []);

  return (
    <OpenSettingsContext.Provider value={openSettings}>
      {children}
      <SettingsDialog
        open={open}
        onOpenChange={setOpen}
        section={section}
        onSectionChange={setSection}
        displayName={displayName}
        email={email}
      />
    </OpenSettingsContext.Provider>
  );
}

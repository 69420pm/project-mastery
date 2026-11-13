import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/features/auth/server/actions", () => ({
  saveDisplayName: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/features/usage", () => ({}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

const { SettingsProvider, useOpenSettings } =
  await import("./settings-provider");
const { Sidebar, SidebarContent, SidebarProvider } =
  await import("@/components/ui/sidebar");

/** A viewport whose width the test sets, with media query change events. */
function stubViewport(width: number) {
  const listeners = new Set<() => void>();
  const viewport = { width };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        const max = Number(/max-width: (\d+)px/.exec(query)?.[1]);
        return viewport.width <= max;
      },
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    })),
  );
  return {
    resize(to: number) {
      viewport.width = to;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function OpenSettingsButton() {
  const open = useOpenSettings();
  return <button onClick={open}>Open settings</button>;
}

function renderShell() {
  return render(
    <SettingsProvider email="s@example.com" displayName="Sam">
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <OpenSettingsButton />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </SettingsProvider>,
  );
}

test("Settings stays open in its section when the window crosses the breakpoint", () => {
  const viewport = stubViewport(1200);
  renderShell();

  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Appearance" }));
  expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
    "data-state",
    "active",
  );

  act(() => viewport.resize(500));
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
    "data-state",
    "active",
  );

  act(() => viewport.resize(1200));
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

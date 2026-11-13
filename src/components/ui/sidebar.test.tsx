import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
} from "./sidebar";

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

test("the phone slide-over opens only on request and is closed again after crossing the breakpoint", () => {
  const viewport = stubViewport(500);
  render(
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>Menu</SidebarContent>
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  act(() => viewport.resize(1200));
  act(() => viewport.resize(500));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

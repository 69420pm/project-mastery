import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { MemoryCard } from "./memory-card";

vi.mock("@/features/study/server/actions", () => ({ saveMemory: vi.fn() }));

describe("MemoryCard on a refresh", () => {
  test("shows the refreshed text when the Student has not edited it", () => {
    const { rerender } = render(<MemoryCard courseId="c1" text="Old." />);
    rerender(<MemoryCard courseId="c1" text="New." />);
    expect(screen.getByRole("textbox", { name: "Memory" })).toHaveValue("New.");
  });

  test("keeps a draft in progress", () => {
    const { rerender } = render(<MemoryCard courseId="c1" text="Old." />);
    fireEvent.change(screen.getByRole("textbox", { name: "Memory" }), {
      target: { value: "Old. Mine" },
    });
    rerender(<MemoryCard courseId="c1" text="New." />);
    expect(screen.getByRole("textbox", { name: "Memory" })).toHaveValue(
      "Old. Mine",
    );
  });
});

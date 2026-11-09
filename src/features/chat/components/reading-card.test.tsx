import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ChatSource } from "@/features/chat/types";

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const SECTION = "aaaaaaaa-5000-4000-8000-000000000001";
const reading = {
  id: "call-1",
  sectionId: SECTION,
  label: "Lecture 3, pp. 12–14",
  purpose: "What makes thrust?",
};

const openSource = vi.fn();
vi.mock("@/features/chat/server/actions", () => ({
  openSource: (...args: unknown[]) => openSource(...args),
}));
// The file itself loads from Storage; the pane only says what to show.
vi.mock("@/features/courses", async () => ({
  ...(await vi.importActual<object>("@/features/courses/domain/course-paths")),
  MaterialFile: ({ page }: { page?: number }) => <p>PDF at page {page}</p>,
}));
// Wide: the pane sits beside the Chat.
window.matchMedia = (query: string) =>
  ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList;

const { WithSourcePane } = await import("./source-pane");
const { ReadingCard } = await import("./reading-card");

function renderCard({ autoOpen = false }: { autoOpen?: boolean } = {}) {
  render(
    <WithSourcePane courseId={COURSE}>
      <ReadingCard reading={reading} autoOpen={autoOpen} />
    </WithSourcePane>,
  );
  return screen.getByRole("region", { name: "Reading" });
}

function serve() {
  openSource.mockResolvedValue({
    ok: true,
    data: {
      materialId: "m-1",
      materialName: "Lecture 3",
      pageFrom: 12,
      pageTo: 14,
    } satisfies ChatSource,
  });
}

beforeEach(() => {
  openSource.mockReset();
  serve();
});

test("a card shows its label and purpose, and Open shows its pages in the pane", async () => {
  const card = renderCard();
  expect(card).toHaveTextContent("Lecture 3, pp. 12–14");
  expect(card).toHaveTextContent("What makes thrust?");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

  fireEvent.click(within(card).getByRole("button", { name: "Open" }));
  const pane = screen.getByRole("complementary", { name: "Source" });
  expect(await within(pane).findByText("PDF at page 12")).toBeVisible();
  expect(openSource).toHaveBeenCalledWith({
    courseId: COURSE,
    kind: "section",
    id: SECTION,
  });
  expect(
    screen.queryByRole("button", { name: "Done" }),
  ).not.toBeInTheDocument();
});

test("a card that arrives in a reply opens the pane on its own", async () => {
  renderCard({ autoOpen: true });
  const pane = screen.getByRole("complementary", { name: "Source" });
  expect(await within(pane).findByText("PDF at page 12")).toBeVisible();
});

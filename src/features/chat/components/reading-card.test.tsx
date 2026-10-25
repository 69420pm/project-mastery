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
// Wide: the pane sits beside the conversation.
window.matchMedia = (query: string) =>
  ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList;

const { WithSourcePane } = await import("./source-pane");
const { ReadingCard } = await import("./reading-card");

const onDone = vi.fn();

function renderCard({
  done = false,
  canAnswer = true,
  autoOpen = false,
}: { done?: boolean; canAnswer?: boolean; autoOpen?: boolean } = {}) {
  const doneCards = new Set(done ? [reading.id] : []);
  render(
    <WithSourcePane
      courseId={COURSE}
      reading={{ done: doneCards, canDone: canAnswer, onDone }}
    >
      <ReadingCard
        reading={reading}
        done={done}
        canAnswer={canAnswer}
        autoOpen={autoOpen}
        onDone={() => onDone(SECTION)}
      />
    </WithSourcePane>,
  );
  return screen.getByRole("region", { name: "Reading" });
}

function serve(section: Partial<NonNullable<ChatSource["reading"]>>) {
  openSource.mockResolvedValue({
    ok: true,
    data: {
      materialId: "m-1",
      materialName: "Lecture 3",
      pageFrom: 12,
      pageTo: 14,
      reading: {
        mode: "original",
        annotations: null,
        studyText: null,
        ...section,
      },
    },
  });
}

beforeEach(() => {
  openSource.mockReset();
  onDone.mockReset();
  serve({});
});

test("an open card shows its label and purpose, opens the pane and sends Done", async () => {
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

  fireEvent.click(within(card).getByRole("button", { name: "Done" }));
  fireEvent.click(within(pane).getByRole("button", { name: "Done" }));
  expect(onDone.mock.calls).toEqual([[SECTION], [SECTION]]);
});

test("a done card shows Read without Done, in the card and the pane", async () => {
  const card = renderCard({ done: true, autoOpen: true });
  expect(card).toHaveAttribute("data-reading-state", "done");
  expect(card).toHaveTextContent("Read");

  const pane = screen.getByRole("complementary", { name: "Source" });
  await within(pane).findByText("PDF at page 12");
  expect(
    screen.queryByRole("button", { name: "Done" }),
  ).not.toBeInTheDocument();
  expect(pane).toHaveTextContent("Read");
});

test("Done is disabled while no answer could be sent", () => {
  const card = renderCard({ canAnswer: false });
  expect(within(card).getByRole("button", { name: "Done" })).toBeDisabled();
});

test("the mode switch starts on the stored mode and shows only the views the section has", async () => {
  serve({ mode: "study_text", studyText: "Thrust in **short**." });
  renderCard({ autoOpen: true });
  const pane = screen.getByRole("complementary", { name: "Source" });

  const modes = await within(pane).findByRole("tablist", {
    name: "Reading mode",
  });
  expect(
    within(modes)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["Original", "Study text"]);
  expect(
    within(modes).getByRole("tab", { name: "Study text" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(pane).toHaveTextContent("Thrust in short.");

  fireEvent.mouseDown(within(modes).getByRole("tab", { name: "Original" }));
  expect(await within(pane).findByText("PDF at page 12")).toBeVisible();
});

test("the Annotated view lists the page's notes above it", async () => {
  serve({
    mode: "annotated",
    annotations: [
      { page: 12, note: "Mind the sign of $v_0$." },
      { page: 13, note: "Not this one." },
    ],
  });
  renderCard({ autoOpen: true });
  const pane = screen.getByRole("complementary", { name: "Source" });

  const notes = await within(pane).findByRole("list", {
    name: "Notes on page 12",
  });
  expect(notes).toHaveTextContent("Mind the sign of");
  expect(notes).not.toHaveTextContent("Not this one.");
  expect(
    within(pane)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["Original", "Annotated"]);
});

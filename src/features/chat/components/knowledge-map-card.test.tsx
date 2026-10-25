import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const TOPIC = "aaaaaaaa-7000-4000-8000-000000000001";
const SECTION = "aaaaaaaa-5000-4000-8000-000000000001";

const openSource = vi.fn();
vi.mock("@/features/chat/server/actions", () => ({
  openSource: (...args: unknown[]) => openSource(...args),
}));
vi.mock("@/features/courses", async () => ({
  ...(await vi.importActual<object>("@/features/courses/domain/course-paths")),
  MaterialFile: () => <p>PDF</p>,
}));
window.matchMedia = (query: string) =>
  ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList;

const { WithSourcePane } = await import("./source-pane");
const { KnowledgeMapCard } = await import("./knowledge-map-card");
const { ReadingCard } = await import("./reading-card");

beforeEach(() => {
  openSource.mockReset().mockResolvedValue({ ok: false, message: "Nope" });
});

function renderCard(autoOpen: boolean) {
  render(
    <WithSourcePane
      courseId={COURSE}
      // The Chat passes the study feature's graph.
      topicGraph={(topicId) => <p>Graph of {topicId}</p>}
    >
      <KnowledgeMapCard
        knowledgeMap={{ id: "g1", topicId: TOPIC }}
        autoOpen={autoOpen}
      />
      <ReadingCard
        reading={{ id: "r1", sectionId: SECTION, label: "L3", purpose: "?" }}
        done={false}
        canAnswer
        autoOpen={false}
        onDone={() => {}}
      />
    </WithSourcePane>,
  );
  return screen.getByRole("region", { name: "Knowledge map" });
}

test("Open map shows the Topic's KC graph in the side slot", () => {
  const card = renderCard(false);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

  fireEvent.click(within(card).getByRole("button", { name: "Open map" }));
  const pane = screen.getByRole("complementary", { name: "Source" });
  expect(within(pane).getByText(`Graph of ${TOPIC}`)).toBeVisible();
  expect(within(pane).getByRole("heading")).toHaveTextContent("Knowledge map");
});

test("a card arriving in a reply opens the graph on its own, and a source replaces it", async () => {
  renderCard(true);
  const pane = screen.getByRole("complementary", { name: "Source" });
  expect(within(pane).getByText(`Graph of ${TOPIC}`)).toBeVisible();

  fireEvent.click(
    within(screen.getByRole("region", { name: "Reading" })).getByRole(
      "button",
      { name: "Open" },
    ),
  );
  expect(await within(pane).findByText("Nope")).toBeVisible();
  expect(within(pane).queryByText(/Graph of/)).not.toBeInTheDocument();
});

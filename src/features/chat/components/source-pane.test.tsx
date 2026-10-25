import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
const MATERIAL = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CHUNK = "aaaaaaaa-0000-4000-8000-00000000c001";
const citation = `/courses/${COURSE}/materials/${MATERIAL}#chunk-${CHUNK}`;

const openSource = vi.fn();
vi.mock("@/features/chat/server/actions", () => ({
  openSource: (...args: unknown[]) => openSource(...args),
}));
// The courses entry without its server code. The file itself loads from
// Storage; the pane only says what to show.
vi.mock("@/features/courses", async () => ({
  ...(await vi.importActual<object>("@/features/courses/domain/course-paths")),
  ...(await vi.importActual<object>("@/features/courses/schemas")),
  MaterialFile: ({ name, page }: { name: string; page?: number }) => (
    <p>
      File {name} at page {page}
    </p>
  ),
}));
// Wide: the pane sits beside the conversation.
window.matchMedia = (query: string) =>
  ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList;

const { Markdown } = await import("@/components/markdown");
const { chatMarkdownComponents } = await import("./citation-link");
const { WithSourcePane } = await import("./source-pane");

/** Reply text beside the source pane, as in a Chat. */
const Harness = ({ text }: { text: string }) => (
  <WithSourcePane courseId={COURSE}>
    <Markdown components={chatMarkdownComponents}>{text}</Markdown>
  </WithSourcePane>
);

beforeEach(() => {
  openSource.mockReset();
  openSource.mockResolvedValue({
    ok: true,
    data: {
      materialId: MATERIAL,
      materialName: "Lecture 7",
      pageFrom: 3,
      pageTo: 5,
      reading: null,
    },
  });
});

test("a citation click opens the cited page in the pane, and Close closes it", async () => {
  render(<Harness text={`Thrust is a force [Lecture 7](${citation}).`} />);

  fireEvent.click(screen.getByRole("link", { name: "Lecture 7" }));

  const pane = screen.getByRole("complementary", { name: "Source" });
  expect(
    await within(pane).findByText("File Lecture 7 at page 3"),
  ).toBeVisible();
  expect(pane).toHaveTextContent("pp. 3–5");
  expect(openSource).toHaveBeenCalledWith({
    courseId: COURSE,
    kind: "chunk",
    id: CHUNK,
  });

  fireEvent.click(within(pane).getByRole("button", { name: "Close source" }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

test("a modifier click follows the citation instead", () => {
  render(<Harness text={`See [Lecture 7](${citation}).`} />);
  const link = screen.getByRole("link", { name: "Lecture 7" });
  expect(link).toHaveAttribute("href", citation);

  const followed = fireEvent.click(link, { ctrlKey: true });

  expect(followed).toBe(true);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

test("a link that is no citation of this Course behaves as before", () => {
  const other = `/courses/bbbbbbbb-c000-4000-8000-000000000001/materials/${MATERIAL}#chunk-${CHUNK}`;
  render(<Harness text={`See [elsewhere](${other}).`} />);

  fireEvent.click(screen.getByText("elsewhere"));

  expect(openSource).not.toHaveBeenCalled();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

test("a source not in the Course shows that it could not be found", async () => {
  openSource.mockResolvedValue({
    ok: false,
    message: "This source could not be found.",
  });
  render(<Harness text={`See [Lecture 7](${citation}).`} />);

  fireEvent.click(screen.getByRole("link", { name: "Lecture 7" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This source could not be found.",
  );
});

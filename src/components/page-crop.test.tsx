import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PageCrop } from "./page-crop";

const pdf = {};
const getDocument = vi.hoisted(() => vi.fn());

// PDF.js needs a worker and canvas, which jsdom lacks. The mock opens a
// document and renders the page number and the width it was asked for.
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {}, getDocument },
  Page: ({
    pageNumber,
    width,
    onLoadSuccess,
  }: {
    pageNumber: number;
    width: number;
    onLoadSuccess: (page: {
      originalWidth: number;
      originalHeight: number;
    }) => void;
  }) => (
    <button
      data-testid="pdf-page"
      onClick={() => onLoadSuccess({ originalWidth: 600, originalHeight: 800 })}
    >
      {pageNumber}@{width}
    </button>
  ),
}));

beforeEach(() => {
  getDocument.mockReset();
  getDocument.mockImplementation(() => ({
    promise: Promise.resolve(pdf),
    destroy: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 400 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
});

const box = { x: 0.2, y: 0.1, width: 0.5, height: 0.25 };

describe("a PDF page", () => {
  test("renders the page magnified so the box fills the width, offset to the box", async () => {
    render(
      <PageCrop
        file="/lecture.pdf"
        mediaType="application/pdf"
        page={3}
        box={box}
        alt="A parabola."
      />,
    );

    const page = await screen.findByTestId("pdf-page");
    // 400px wide window over half the page's width.
    expect(page).toHaveTextContent("3@800");
    act(() => void fireEvent.click(page));
    const frame = screen.getByRole("img", { name: "A parabola." });
    // Half the width of a 3:4 page over a quarter of its height.
    expect(frame.style.aspectRatio).toBe("1.5 / 1");
    expect(frame.firstElementChild).toHaveStyle({
      width: "200%",
      left: "-40%",
      top: "-40%",
    });
  });

  test("shows the whole page without a box", async () => {
    render(
      <PageCrop
        file="/lecture.pdf"
        mediaType="application/pdf"
        page={1}
        box={null}
        alt="Page 1"
      />,
    );

    expect(await screen.findByTestId("pdf-page")).toHaveTextContent("1@400");
    expect(
      screen.getByRole("img", { name: "Page 1" }).firstElementChild,
    ).toHaveStyle({ width: "100%", left: "0%", top: "0%" });
  });

  test("opens a file once for all its crops", async () => {
    render(
      <>
        <PageCrop
          file="/once.pdf"
          mediaType="application/pdf"
          page={1}
          box={box}
          alt="One"
        />
        <PageCrop
          file="/once.pdf"
          mediaType="application/pdf"
          page={2}
          box={null}
          alt="Two"
        />
      </>,
    );

    expect(await screen.findAllByTestId("pdf-page")).toHaveLength(2);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  test("says so when the file cannot be opened", async () => {
    getDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error("no")),
      destroy: vi.fn(),
    }));

    render(
      <PageCrop
        file="/broken.pdf"
        mediaType="application/pdf"
        page={1}
        box={box}
        alt="A"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The page could not be loaded.",
    );
  });
});

describe("an image", () => {
  test("crops the image itself, without PDF.js", () => {
    render(
      <PageCrop
        file="/board.png"
        mediaType="image/png"
        page={1}
        box={box}
        alt="Board"
      />,
    );

    const frame = screen.getByRole("img", { name: "Board" });
    expect(frame.querySelector("img")).toHaveAttribute("src", "/board.png");
    expect(frame.firstElementChild).toHaveStyle({
      width: "200%",
      left: "-40%",
    });
    expect(getDocument).not.toHaveBeenCalled();
  });
});

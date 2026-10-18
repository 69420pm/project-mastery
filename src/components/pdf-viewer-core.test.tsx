import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PdfViewerCore } from "./pdf-viewer-core";

const pdf = vi.hoisted(() => ({ loadFails: false }));

// PDF.js needs a worker and canvas, which jsdom lacks. The mock loads a
// five-page document, or fails to when `pdf.loadFails` is set, renders the
// requested page number as text, and has a link inside the PDF to page 4.
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({
    children,
    error,
    onLoadSuccess,
    onItemClick,
  }: {
    children: ReactNode;
    error: ReactNode;
    onLoadSuccess: (document: { numPages: number }) => void;
    onItemClick: (item: { pageNumber: number }) => void;
  }) => {
    useEffect(() => {
      if (!pdf.loadFails) onLoadSuccess({ numPages: 5 });
    }, [onLoadSuccess]);
    if (pdf.loadFails) return <div>{error}</div>;
    return (
      <div>
        <button type="button" onClick={() => onItemClick({ pageNumber: 4 })}>
          Contents: chapter 4
        </button>
        {children}
      </div>
    );
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid="pdf-page">{pageNumber}</div>
  ),
}));

beforeEach(() => {
  pdf.loadFails = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 600 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
});

describe("PdfViewerCore", () => {
  test("shows the requested page and jumps when it changes", async () => {
    const { rerender } = render(<PdfViewerCore file="/slides.pdf" page={3} />);

    expect(await screen.findByTestId("pdf-page")).toHaveTextContent("3");
    expect(screen.getByText("Page 3 of 5")).toBeInTheDocument();

    rerender(<PdfViewerCore file="/slides.pdf" page={5} />);
    expect(screen.getByTestId("pdf-page")).toHaveTextContent("5");
  });

  test("clamps a page number beyond the document", async () => {
    render(<PdfViewerCore file="/slides.pdf" page={42} />);

    expect(await screen.findByText("Page 5 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  test("says so when the document cannot be loaded", async () => {
    pdf.loadFails = true;
    render(<PdfViewerCore file="/broken.pdf" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The document could not be loaded.",
    );
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });

  test("a link inside the PDF jumps to its page", async () => {
    const onPageChange = vi.fn();
    render(<PdfViewerCore file="/slides.pdf" onPageChange={onPageChange} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Contents: chapter 4" }),
    );

    expect(screen.getByTestId("pdf-page")).toHaveTextContent("4");
    expect(screen.getByText("Page 4 of 5")).toBeInTheDocument();
    expect(onPageChange).toHaveBeenLastCalledWith(4);
  });

  test("navigates with the page buttons", async () => {
    const onPageChange = vi.fn();
    render(
      <PdfViewerCore
        file="/slides.pdf"
        defaultPage={2}
        onPageChange={onPageChange}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
    expect(screen.getByTestId("pdf-page")).toHaveTextContent("3");
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByTestId("pdf-page")).toHaveTextContent("1");
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
  });
});

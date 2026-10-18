import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";

const COURSE = "aaaaaaaa-c000-4000-8000-000000000001";
let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList;

const { KnowledgeMapLink } = await import("./knowledge-map-link");

const renderLink = () =>
  render(
    <SidebarProvider>
      <KnowledgeMapLink courseId={COURSE} />
    </SidebarProvider>,
  );

test("links to the Course's Knowledge map, marked current on that page", () => {
  pathname = `/courses/${COURSE}/map`;
  renderLink();

  const link = screen.getByRole("link", { name: "Knowledge map" });
  expect(link).toHaveAttribute("href", `/courses/${COURSE}/map`);
  expect(link).toHaveAttribute("aria-current", "page");
});

test("is not current on another page of the Course", () => {
  pathname = `/courses/${COURSE}`;
  renderLink();
  expect(
    screen.getByRole("link", { name: "Knowledge map" }),
  ).not.toHaveAttribute("aria-current");
});

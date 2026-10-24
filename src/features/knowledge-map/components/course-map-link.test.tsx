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

const { CourseMapLink } = await import("./course-map-link");

const renderLink = () =>
  render(
    <SidebarProvider>
      <CourseMapLink courseId={COURSE} />
    </SidebarProvider>,
  );

test("links to the Course map, marked current on that page", () => {
  pathname = `/courses/${COURSE}/map`;
  renderLink();

  const link = screen.getByRole("link", { name: "Course map" });
  expect(link).toHaveAttribute("href", `/courses/${COURSE}/map`);
  expect(link).toHaveAttribute("aria-current", "page");
});

test("is not current on another page of the Course", () => {
  pathname = `/courses/${COURSE}/materials`;
  renderLink();
  expect(screen.getByRole("link", { name: "Course map" })).not.toHaveAttribute(
    "aria-current",
  );
});

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** A crumb that always leads somewhere, such as the open Course. */
export type Crumb = { href: string; label: ReactNode };

/** A part of the app the current path may be in. */
export type BreadcrumbSection = {
  /** The path the section starts at. */
  path: string;
  label: ReactNode;
  /** Matches only `path` itself, not the paths below it. */
  exact?: boolean;
  /** Where the crumb leads when the current page is below `path`. */
  href?: string;
};

/** The section the path is in: an exact match first, then the longest. */
function sectionOf(pathname: string, sections: BreadcrumbSection[]) {
  const matches = sections.filter(
    ({ path, exact }) =>
      pathname === path || (!exact && pathname.startsWith(`${path}/`)),
  );
  return (
    matches.find(({ path }) => path === pathname) ??
    [...matches].sort((a, b) => b.path.length - a.path.length)[0]
  );
}

/**
 * The top bar's breadcrumb: the `trail` of links, then the section the
 * current path is in. Without a matching section the last crumb of the trail
 * is the current page.
 */
export function PathBreadcrumb({
  trail,
  sections = [],
}: {
  trail: Crumb[];
  sections?: BreadcrumbSection[];
}) {
  const pathname = usePathname();
  const section = sectionOf(pathname, sections);
  const links = section ? trail : trail.slice(0, -1);
  const last = section ?? trail.at(-1);

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {links.map((crumb) => (
          <Fragment key={crumb.href}>
            <BreadcrumbItem className="hidden min-w-0 md:inline-flex">
              <BreadcrumbLink asChild className="truncate">
                <Link href={crumb.href}>{crumb.label}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </Fragment>
        ))}
        {last && (
          <BreadcrumbItem className="min-w-0">
            {section?.href && section.href !== pathname ? (
              <BreadcrumbLink asChild className="truncate">
                <Link href={section.href}>{section.label}</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage className="truncate">{last.label}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

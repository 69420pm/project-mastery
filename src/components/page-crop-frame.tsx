import { cn } from "@/lib/utils";

/** A box on a page, normalized to the page's size: 0 to 1, from the top left. */
export type PageBox = { x: number; y: number; width: number; height: number };

const WHOLE_PAGE: PageBox = { x: 0, y: 0, width: 1, height: 1 };

/** The box to show: the given one, or the whole page. */
export function shownBox(box: PageBox | null): PageBox {
  return box ?? WHOLE_PAGE;
}

/**
 * A window onto a box of a page. The page is laid out at the size where the
 * box fills the window's width, offset so the box is in view and the rest is
 * clipped. `aspect` is the page's width over its height.
 */
export function PageCropFrame({
  ref,
  box,
  aspect,
  label,
  className,
  children,
}: {
  ref?: React.Ref<HTMLDivElement>;
  box: PageBox | null;
  aspect: number;
  /** What the window shows, for assistive technology. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const shown = shownBox(box);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={cn(
        "relative w-full overflow-hidden rounded-md border bg-white",
        className,
      )}
      style={{ aspectRatio: (shown.width * aspect) / shown.height }}
    >
      <div
        className="absolute"
        style={{
          width: `${100 / shown.width}%`,
          left: `${(-100 * shown.x) / shown.width}%`,
          top: `${(-100 * shown.y) / shown.height}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

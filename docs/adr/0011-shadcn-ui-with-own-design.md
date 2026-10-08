# UI built on shadcn/ui with its own design

**Context.** The app should look professional and distinct. shadcn/ui gives accessible, consistent components that the codebase owns, but its defaults look like every other shadcn app.

**Decision.** Build on shadcn/ui and AI Elements for chat, with the project's own design tokens for typography, color, dark mode and motion. Render math with KaTeX and stream AI answers with Streamdown. Show cited pages in a PDF viewer that jumps to the page.

**Consequences.** A small design direction is set before the first feature screens, so every screen follows it.

shadcn/ui uses Radix primitives, which AI Elements builds on. The design tokens live in `src/app/globals.css` in three layers (palette inputs, semantic tokens per color mode, Tailwind theme), so the design direction changes values in one place; until it is decided they hold neutral placeholders. Dark mode follows the system by default through `next-themes`. AI answers render through one `Markdown` component (Streamdown with KaTeX, `$…$` and `$$…$$` as math), and the PDF viewer loads only in the browser.

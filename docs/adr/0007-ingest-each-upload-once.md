# Ingestion: process every upload once

**Context.** Grounded answers need citations down to the slide or page. Course PDFs in STEM are full of formulas, diagrams and scanned exams, which plain text extraction loses. Not every model accepts PDF files directly, but most current models accept images.

**Decision.** Ingest each upload once in a background workflow: render each page to an image, convert it with a vision model to markdown with LaTeX, split it into chunks that keep their page reference, embed the chunks into pgvector, and derive the topic map. Every feature reuses this result.

The parse makes two kinds of call, both on the `ingest` task:

- **One vision call per page.** It gets the page image (a PDF page rendered to PNG at scale 2, or the uploaded image itself) and returns structured units: markdown in the source language with LaTeX formulas and Mermaid for flowcharts and trees, one of seven labels (content, definition, example, exercise, solution, figure, admin), an optional exercise number and points, an optional figure with a description and a box normalized to the page, and whether the unit continues across a page break. Each page's result is stored, so a retried parse skips finished pages.
- **One text call per file.** It merges units into chunks across page breaks, splits exercises into subtasks and recognises old exams, working on unit ids so the markdown is not generated twice. Code checks that every unit lands in exactly one chunk of neighbouring units and every page is covered, or the step fails and retries; the chunks then replace any earlier ones in one transaction (`public.replace_material_chunks`).

Figures keep an image crop of the page, cut by code from the model's box, with the whole page as the fallback for a bad box. The starting model is `google/gemini-3.5-flash-lite`, the cheapest vision model with a free-tier quota large enough to parse whole scripts; the task can move to a flash model in `src/lib/ai/models.ts` when real material needs it. Every call is recorded against the Student's Daily limit, and there is no page cap.

**Consequences.** Works with any vision model, so the ingestion model can change freely. Ingestion cost is paid once per upload, not per question. The exact conversion model is chosen by testing on real course materials. Until chunks are used in Chats, Chats send attached Materials raw, as inline files, on every turn, so they are paid for again with each message.

# Ingestion: process every upload once

**Context.** Grounded answers need citations down to the slide or page. Course PDFs in STEM are full of formulas, diagrams and scanned exams, which plain text extraction loses. Not every model accepts PDF files directly, but most current models accept images.

**Decision.** Ingest each upload once in a background workflow: render each page to an image, convert it with a vision model to markdown with LaTeX, split it into chunks that keep their page reference, embed the chunks into pgvector, and derive the topic map. Every feature reuses this result.

**Consequences.** Works with any vision model, so the ingestion model can change freely. Ingestion cost is paid once per upload, not per question. The exact conversion model is chosen by testing on real course materials.

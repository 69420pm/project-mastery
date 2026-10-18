# ADR Format

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

## Template

```md
# {Short title of the decision}

**Context.** {The situation and constraints that force a choice.}

**Decision.** {What we decided, and the alternatives it rules out when they are worth remembering.}

**Consequences.** {What follows: costs, limits, what becomes easier or harder.}
```

Each part is one paragraph. Keep them short: the value is in recording _that_ a decision was made and _why_, not in filling the sections.

## Superseding

A later ADR that replaces all or part of an earlier one says so in its Decision. The earlier ADR keeps its text and gets a blockquote under its title that names the part replaced and links the new ADR:

```md
> Local development: superseded by [ADR 0016](0016-gemini-api-for-local-development.md), which moves the text tasks to the Gemini API. Preview and production are unchanged.
```

There is no Status field. Changing a recorded decision means updating its ADR, or superseding it this way, in the same PR.

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it: you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library: just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite. These stop the next engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** "We can't use AWS because of compliance requirements." "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it; otherwise someone will suggest GraphQL again in six months.

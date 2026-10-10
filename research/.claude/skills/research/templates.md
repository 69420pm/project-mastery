# Templates

Copy the block for the file you are writing. Drop a field only when it truly does not apply, and write "not reported" when a paper leaves it out.

## Question: `questions/Q-xxx-<slug>.md`

```markdown
---
id: Q-xxx
status: open # open | awaiting-pdfs | done
priority: high # impact on the design × current uncertainty: high | medium | low
principles: [5, 6] # VISION.md principle numbers it serves
---

# <Question as a decision>

**Decision:** what the app must decide, and where in the product it shows up.

**Why it's uncertain:** the tension or open point that makes this worth researching.

## Sub-questions

- ...

## What would change the design

The answers that would lead to different product behavior.

## Outcome

Links to the synthesis and design rules, once done.
```

## Source card: `sources/<firstauthor>-<year>-<slug>.md`

```markdown
---
doi: 10.xxxx/xxxxx
read: abstract # abstract | full text
type: meta-analysis # meta-analysis | review | practice guide | RCT | quasi-experiment | lab experiment | theory
quality: medium # high | medium | low
transfer: far # near | medium | far, relative to our setting
questions: [Q-xxx]
---

# <Authors> (<year>). <Title>

<Venue>. https://doi.org/<doi>

- **Design and population:** who, how many, which country and level, lab or classroom
- **Intervention vs. comparison:**
- **Outcome and delay:** what was measured, and how long after learning
- **Effect:** effect size with its uncertainty (CI, k studies, heterogeneity)
- **Boundary conditions:** when it worked, when it didn't, moderators
- **Quality notes:** why the rating, including risk of bias and publication bias
- **Transfer notes:** why the rating, measured against university STEM, self-paced, AI-mediated study with a delayed exam

> "Short quote that carries the key claim." (p. X)
```

## Synthesis: `syntheses/Q-xxx.md`

```markdown
# Q-xxx: <question>

## Answer

The bottom line in 3–5 sentences, with its confidence grade.

## Sub-questions

### <Sub-question>

The answer, citing cards as [author year](../sources/<card>.md). Grade: B.

## Evidence

| Source | Type | Read | Population | Effect | Transfer |
| ------ | ---- | ---- | ---------- | ------ | -------- |

## Challenges

Each skeptic point and how it was resolved: claim changed, or why it does not hold.

## Gaps

What remains unknown, caps that were hit, and PDFs that were missing.

## Rules

- [DR-xxx](../design-rules/DR-xxx-<slug>.md)
```

## Design rule: `design-rules/DR-xxx-<slug>.md`

```markdown
---
id: DR-xxx
grade: B # A | B | C | D, see AGENTS.md
questions: [Q-xxx]
---

# <The rule as an instruction to the app>

**Rationale:** why, in 2–4 sentences, citing the synthesis.

**Boundaries:** when the rule doesn't apply.

**What would change our mind:** the evidence or app data that would overturn it.

**How to measure in the app:** the metric or experiment that tests it on our own users.
```

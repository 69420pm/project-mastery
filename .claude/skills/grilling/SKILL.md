---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

The tree holds two kinds of decision. A **product decision** changes what someone using the product sees or can do, what their data means, what running it costs, or what gets built and in which order: those are the user's. Every other decision is a **build decision** (schema, modules, libraries, thresholds, failure handling): settle it yourself with the option you would have recommended, and keep it with its reason in one line. A product decision that the project's recorded vision or decisions already answer is settled too: cite the source.

Work the tree in **rounds**. The **frontier** is every product decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round with the `AskUserQuestion` tool. One call holds up to four questions, so a larger frontier takes several calls in a row. For each question:

- Make the question text stand on its own, in the words of someone using the product: include the facts the user needs to decide, such as what you found in the code or a conflict with a recorded decision.
- Offer 2–4 options, each carrying its trade-off in the description. Put your recommended option first and end its label with "(Recommended)".

The user's answers, including any free text or notes, settle the round.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The product decisions are the user's: put each to them and wait.

The session is done when the frontier is empty: every product decision settled by the user, every build decision by you. Close with a **walk-through**: the finished thing as its user meets it, step by step, then what it leaves out, then your build decisions, one line each. Ask what in the walk-through would make the user say "this is not what I wanted" once they try it. Do not act on it until the user confirms the walk-through.

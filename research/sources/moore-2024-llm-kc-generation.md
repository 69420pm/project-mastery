---
doi: 10.1145/3657604.3662030
read: full text
type: lab experiment
quality: medium
transfer: medium
questions: [Q-013]
---

# Moore, Schmucker, Mitchell & Stamper (2024). Automated generation and tagging of knowledge components from multiple-choice questions

Proceedings of the ACM Conference on Learning @ Scale (L@S '24), 122–133. https://doi.org/10.1145/3657604.3662030

- **Design and population:** 80 multiple-choice questions (MCQs) each from an undergraduate introductory Chemistry course and a master's-level E-Learning course, both MOOCs. Each set has 40 KCs, two MCQs per KC, tagged by the course authors (p. 124). GPT-4 (gpt-4-0125-preview) saw only the MCQ, the subject and the level, not the course material (p. 125).
- **Intervention vs. comparison:** two prompting strategies ("simulated expert", "simulated textbook") vs. the authors' KCs. For mismatches, three raters per domain chose between the LLM and the human label. For Chemistry, the "experts" were Prolific workers with a bachelor's degree in chemistry; for E-Learning, instructional staff of the course (p. 126). An ontology-induction algorithm recursively partitioned the questions into groups.
- **Outcome and delay:** exact match with author KCs, match within the LLM's top five, rater preference and grouping accuracy; no student data, no learning outcome
- **Effect:**
  - **Direct match:** 56% (45/80) Chemistry and 35% (28/80) E-Learning for the textbook strategy; top five: 79% and 63% (Table 2, p. 128). The text also reports Chemistry as 42/80 (52%) in its z-test, an internal inconsistency.
  - **Preference on mismatches:** LLM label preferred in 23/35 Chemistry and 32/52 E-Learning cases; 57/87 overall, binomial p = .017 (p. 129). Agreement was modest: unanimous in only 29% and 35% of cases.
  - **Grouping:** Chemistry converged at 42 groups vs. 40 expert KCs, with 65% of question pairs grouped correctly; E-Learning at 63 groups, with 17.5% (p. 129)
- **Boundary conditions:**
  - The LLM "often favors general options over precise and domain-specific ones" (p. 130); 21% (Chemistry) and 38% (E-Learning) of MCQs matched none of the top five
  - Performance was better in a common introductory subject than in niche content (pp. 130–131)
  - LLM labels were longer before trimming, and the authors suggest readability drove part of the preference (p. 130)
  - The same KC got different wordings on different questions, so the KC model needs de-duplication before it is used for mastery (p. 127)
  - Cost about USD 8 per strategy for 160 MCQs (p. 128)
- **Quality notes:** small (160 items, 6 raters, 3 of them crowd workers); the gold standard itself is questioned by the results; no check against student performance
- **Transfer notes:** university STEM content and a current LLM, close to our pipeline; but it tags multiple-choice items with named concepts, while our map starts from lecture material and math KCs are mostly procedures and derivations

> "Despite reasonable success in identifying the top five KCs, the LLM faced difficulties in accurately selecting the most appropriate KC. It often favors general options over precise and domain-specific ones" (p. 130)

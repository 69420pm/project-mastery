---
doi: 10.1145/3657604.3662030
read: abstract
type: lab experiment
quality: medium
transfer: near
questions: [Q-013]
---

# Moore, Schmucker, Mitchell & Stamper (2024). Automated generation and tagging of knowledge components from multiple-choice questions

Proceedings of the ACM Conference on Learning @ Scale (L@S '24). https://doi.org/10.1145/3657604.3662030

- **Design and population:** GPT-4 generated KCs for multiple-choice questions from higher-education courses in Chemistry and E-Learning; three domain experts per subject judged mismatches against human-made KCs
- **Intervention vs. comparison:** LLM-generated KCs vs. human-assigned KCs; also an ontology-induction algorithm that clusters questions by KC
- **Outcome and delay:** match rate with human KCs and expert preference; no student learning outcome
- **Effect:** best strategy matched human KCs for 56% of Chemistry and 35% of E-Learning questions, higher with the top five suggestions; experts preferred the LLM KC about two-thirds of the time where they differed
- **Boundary conditions:** works from assessment items, not from lecture material; the domain effect (56% vs. 35%) suggests well-structured STEM content is easier
- **Quality notes:** small expert panel; preference is not the same as a KC model that predicts student performance
- **Transfer notes:** university courses and a current LLM, close to our pipeline; but it tags items, while our map is built from material first

> "Human evaluators favored LLM-generated KCs, choosing them over human-assigned ones approximately two-thirds of the time" (abstract)

---
doi: 10.1007/s11257-017-9193-2
read: full text
type: review
quality: medium
transfer: medium
questions: [Q-013]
---

# Pelánek (2017). Bayesian knowledge tracing, logistic models, and beyond: An overview of learner modeling techniques

User Modeling and User-Adapted Interaction, 27, 313–350. https://doi.org/10.1007/s11257-017-9193-2

Read for this question: sections 1–2 (terminology, KCs and the KLI framework), 5.3 (domain modeling), 5.4 (granularity of individualization) and 7 (guidelines). The sections on model families and evaluation methodology were not read.

- **Design and population:** narrative review of learner modelling for adaptive practice systems; no systematic search or pooled effects
- **Intervention vs. comparison:** not applicable
- **Outcome and delay:** not applicable
- **Effect:** not applicable
- **Boundary conditions:**
  - **Granularity trade-off:** "Finer grained KCs lead to potentially more precise models, but also more complex ones with more parameters, fewer data per KC, and thus worse consistency of parameter estimates" (p. 319). Table 2 (p. 319) shows the same content at coarse, medium and fine grain ("fractions" → "addition of fractions" → "with the same denominator").
  - **Domain model forms:** four forms (Fig. 6, p. 331): KCs as disjoint sets of items, multiple KCs per item (a Q-matrix, raising a "credit assignment problem" with "no universal solution"), a hierarchy of KCs at different granularity, and KCs with prerequisites
  - **Building the model:** by experts or by automatic skill discovery, or by combining both: compare candidate models of different granularity on data, or refine an expert model from data (p. 332)
  - **Structure depends on learning process:** prerequisite structure matters "for understanding and sense-making processes", while for memory and fluency a simple disjoint-set model is "typically sufficient (and preferable)" (p. 332)
  - **Coarse KCs:** they mix learners who are strong in different parts, which pushes the model toward clustering learners (p. 333)
  - **Developers' guidance:** prefer simple models "unless there is a clear reason to prefer more complex models", because the weakest link limits the system (p. 342)
  - **Open hypotheses:** forgetting matters more for memory and fluency than for sense-making (Hypothesis 2, p. 343)
- **Quality notes:** solid overview by an active researcher who builds practice systems; its guidance on domain modelling is explicitly offered as orientation that "should be verified and clarified in future research" (p. 333)
- **Transfer notes:** adaptive practice systems in general, mostly school math, languages and geography; no LLM-generated domain models

> "For understanding and sense-making processes it is typically important to take into account a prerequisite structure of the domain. On the other hand, for memory and fluency-building processes it is typically sufficient (and preferable) to use a simpler domain model, such as 'KCs as disjoint sets'." (p. 332)

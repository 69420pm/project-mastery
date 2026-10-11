---
doi: 10.48550/arxiv.2511.09935
read: abstract
type: lab experiment
quality: low
transfer: near
questions: [Q-013]
---

# Wang, Lin & Koedinger (2025). Leveraging large language models for identifying knowledge components

arXiv preprint. https://doi.org/10.48550/arxiv.2511.09935

- **Design and population:** GPT-4o-mini with a "simulated textbook" prompting strategy generated KCs for 646 multiple-choice questions; KC models compared by how well they predict student performance
- **Intervention vs. comparison:** LLM KC model, then LLM KCs merged by cosine similarity of their labels, vs. an expert-designed KC model
- **Outcome and delay:** prediction error (RMSE) of a student model fit on each KC model; no learning outcome
- **Effect:** raw LLM model fit worse than the expert model (RMSE 0.4285 vs. 0.4206) with 569 KCs vs. 101; merging at a cosine threshold of 0.8 reduced it to 428 KCs and improved RMSE to 0.4259, still worse than expert
- **Boundary conditions:** a small, cheaper model; multiple-choice items; subject not reported in the abstract
- **Quality notes:** preprint, not peer reviewed; one dataset; RMSE differences are small in absolute terms
- **Transfer notes:** close to our pipeline: an LLM proposes the units, and student data judges them

> "this initial automated approach performed significantly worse than an expert-designed KC model (RMSE 0.4285 vs. 0.4206) and generated an excessive number of KCs (569 vs. 101)" (abstract)

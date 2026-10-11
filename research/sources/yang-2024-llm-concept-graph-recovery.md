---
doi: 10.48550/arxiv.2402.14293
read: full text
type: lab experiment
quality: low
transfer: medium
questions: [Q-013]
---

# Yang, Yang, Ouyang, She, Feng, Jiang, Lecue, Lu & Li (2024). Leveraging large language models for concept graph recovery and question answering in NLP education

arXiv preprint 2402.14293v1. https://doi.org/10.48550/arxiv.2402.14293

- **Design and population:** prerequisite-edge prediction on LectureBankCD, which has expert prerequisite annotations for a given set of concepts: 322 in NLP, 201 in computer vision, 100 in bioinformatics (p. 4). The concepts are given; the task is only to decide, for each pair, whether learning A helps with B (p. 3). A second part builds TutorQA, a 500-question benchmark, not relevant here.
- **Intervention vs. comparison:** zero-shot LLMs (LLaMa2-70b, GPT-3.5, GPT-4) with a yes/no prompt per concept pair, with or without retrieval, vs. supervised baselines (P2V, BERT, DeepWalk, Node2vec) and supervised LLaMa embeddings with a graph network
- **Outcome and delay:** accuracy and F1 on the official test split; no student outcome
- **Effect:**
  - **Zero-shot GPT-4:** accuracy 0.75 and F1 0.78 overall (NLP 0.76/0.79, CV 0.74/0.76, BIO 0.73/0.77)
  - **Comparisons:** better than the best classical supervised baseline (Node2vec F1 0.75), below the supervised LLaMa graph model (F1 0.81)
  - **Retrieval:** did not consistently help (Table 1, p. 4)
  - About one pairwise judgment in four was wrong. The ratio of true to false pairs in the test set is not given in the parts read.
- **Boundary conditions:**
  - Adding the lecture-note documents to the prompt "significantly diminishes performance" (LLaMa, NLP; p. 7); chain-of-thought prompting lowered F1 sharply (0.65 NLP, 0.42 CV; Table 5, p. 7)
  - The authors suspect GPT models had already seen the data (p. 4)
  - Full pairwise prediction grows quadratically with concept count, so they sampled edges assuming a sparse graph (p. 9)
- **Quality notes:** preprint; one benchmark that may be in the training data; no confidence intervals
- **Transfer notes:** university-level computing content, but a field-wide concept graph with given concepts, not one course's material, and not math

> "incorporating LectureBankCD documents (Doc.) significantly diminishes performance. This decline can be attributed to the introduction of noise and excessively lengthy content" (p. 7)

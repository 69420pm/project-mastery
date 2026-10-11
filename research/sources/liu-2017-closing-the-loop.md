---
doi: 10.5281/zenodo.3554625
read: full text
type: RCT
quality: medium
transfer: medium
questions: [Q-013]
---

# Liu & Koedinger (2017). Closing the loop: Automated data-driven cognitive model discoveries lead to improved instruction and learning gains

Journal of Educational Data Mining, 9(1), 25–41. https://doi.org/10.5281/zenodo.3554625

- **Design and population:**
  - **Discovery:** Learning Factors Analysis (LFA), an automated search over splits and merges of an existing expert KC model, had found that "circle area" fits better as two KCs: forward (find the area from the radius) and backward (find the radius from the area)
  - **Validation:** checked on a new dataset: 82 tenth-graders, 72,404 problem steps, from a different district (p. 28)
  - **Experiment:** 115 students in six geometry classes at one US public high school, randomised individually; 91 analysed (49 control, 42 redesigned), with no differential attrition (p. 33)
- **Intervention vs. comparison:** the redesigned tutor knowledge-traced backward circle and square area as separate KCs, added a hint about the square root and interface scaffolding. The control tutor had one KC per shape. Both used Bayesian knowledge tracing with a 95% mastery threshold (pp. 30–32). The KC split is therefore confounded with the new hint and scaffolding.
- **Outcome and delay:** a 12-item post-test one day after three class days of tutor use (p. 33). Immediate, not delayed.
- **Effect:**
  - Post-test 0.85 (SE 0.03) redesigned vs. 0.73 (0.04) control; pre-test 0.64 vs. 0.58 (p. 34). Cohen's d = 0.47, F(1,89) = 5.04, p = .027; condition remained significant controlling for pre-test (β = 0.09, p = .027) (p. 33).
  - The gain was confined to the three square-root items (β = 0.13, p = .034); not significant on other items (p. 34).
  - Time on tutor did not differ significantly (105 vs. 112 min, p = .07) (p. 35).
  - In the validation data, the better KC model differed from the merged one by a small margin in prediction error: RMSE 0.28087 vs. 0.28208 (p. 30)
- **Boundary conditions:** LFA "requires an initial KC model" and hypothesised difficulty factors, so it "cannot produce large structural changes to KC models" (p. 37). Human interpretation of the discovered split produced the redesign; copying the model alone would not have (pp. 36–37). Validation needed tens of thousands of steps.
- **Quality notes:** randomised, but one school, one KC, small sample and an immediate test; the authors call it "the first-ever demonstration of experimentally closing the loop on an automated KC model improvement" (p. 36)
- **Transfer notes:** high-school geometry in a step-based tutor; shows that a wrong grain in one place in the map costs learning, and that student data can find it

> "prior research has shown that expert-engineered cognitive models often ignore content distinctions that are important for novice learners" (p. 26)

> "it cannot produce large structural changes to KC models" (p. 37)

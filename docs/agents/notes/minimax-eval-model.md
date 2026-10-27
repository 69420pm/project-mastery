# MiniMax M3.1 Flash as an eval model

Measured on 2026-10-27 through AI Gateway (`minimax/minimax-m3.1-flash`, $0.15 / $0.60 per million tokens), against `xiaomi/mimo-v2.6-flash`. Verdict: not a replacement for MiMo.

- **Speed:** about 120 tokens/s against MiMo's 20 to 37, so a 400-word answer takes 6 to 8 s instead of 16 to 31 s. Default reasoning averaged about 1,000 reasoning tokens a call; `reasoning: "none"` still left 0 to 162.
- **Rate limit:** the team's limit is 5 requests per minute per provider, as for MiMo on DeepInfra ("this team's limit of 5 requests per minute (per region) was reached" for Fireworks, "across all regions" for Parasail). The Gateway does not fail over to another provider of `only` when one is limited. Speed therefore buys no eval throughput: `EVAL_GATEWAY_RPM=4 pnpm evals <name>` keeps a run under the limit (`evals/pace.ts`).
- **Providers:** of the eight providers, only `fireworks` honors a structured output's JSON schema (6 of 6 valid). `togetherai` (the fastest, 373 tokens/s) and `parasail` returned invented keys such as `critic_severity` in 16 of 16 runs. Tool calls worked on Parasail (4 of 4) and Together; Fireworks is pinned in `ONLY_PROVIDERS`.
- **Evals** (one run each, paced, Fireworks):

  | Eval         | MiMo                                                                                    | MiniMax                                                 |
  | ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
  | `grade`      | false-full 0.0% and 2.1%, accuracy 88.2% and 91.5% (pass; prompt tuned to MiMo in #203) | false-full 8.0%, accuracy 74.5% (fail), no item skipped |
  | `learn`      | 1 of 2 sessions, $0.074                                                                 | 0 of 2, $0.080, 60 calls                                |
  | `review`     | 0 gated passes, $0.019                                                                  | 1 of 2, $0.089                                          |
  | `grade_exam` | mean error 16.6% of points                                                              | 14.4%                                                   |

- **Failure shape:** MiniMax copied the fixture's repetitive question ids wrongly (`…0001000` for `…1000`), so `grade` hit "no question you asked", and it called `getTopic` with `undefined` and `null`. Then it told the Student that grading was broken. The fixture ids are unusually regular, so real random ids may hurt less; not tested.

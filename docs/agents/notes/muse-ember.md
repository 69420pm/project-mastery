# Muse Ember

Checked on 2026-11-12 through AI Gateway (`meta/muse-ember`, $0.10 / $0.50 per million tokens, cache read $0.004), with the AI SDK and one small call per capability. Registered in `MODEL_PRICES`, so `AI_MODEL_<TASK>=meta/muse-ember` works; no task defaults to it.

- **Reachable on the free credit**: no 403. The Gateway lists one provider, `meta`, so `ONLY_PROVIDERS` needs no entry. Data: zero retention, no training.
- **Text, tools, structured output all worked** (3 of 3 calls each at `reasoning: "minimal"` and `"none"`, `warnings` empty): `generateText` with a tool called it with valid input and continued in text; `Output.object` with a Zod schema (boolean, string, enum array of length 2) returned a valid object.
- **Latency**: 0.7 to 1.5 s for a one-word reply and for a structured verdict, 1.7 to 2.2 s for a tool call plus the answer (two requests). Not measured on long outputs.
- **Reasoning**: it takes `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. `reasoning: "none"` is accepted but still spent 5 reasoning tokens on a one-word reply and 52 on the structured verdict, so unlike MiMo it cannot be switched off. The earlier structured-output failure on MiMo (reasoning leaving the text empty) did not show here.
- **Caching**: implicit; the second step of the tool call read 500 cached input tokens.
- **Rate limit**: 5 requests per minute for this team ("per region", then "across all regions"), as for MiMo and MiniMax. A tool call with one tool result is 2 requests.
- **Tool choice**: only `"auto"`. `toolChoice: "none"` (the Chat's and the Brief's last step) gets a 400, "only `"auto"` is supported for `tool_choice`", which cut tutoring replies short (#277). With `activeTools: []` it still calls the tool, so no step can be forced to text; `textOnlyStep` in `src/lib/ai/models.ts` leaves such a step on `"auto"`. On MiMo, `activeTools: []` made it write a tool call as text.
- **Not tested**: images and PDF input (the listing says it takes both), long contexts, the app's real prompts.

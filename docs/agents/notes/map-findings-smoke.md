# Map findings in a live run

Verified with `pnpm smoke map-findings` on Gemini 3.5 flash-lite (2026-10-25):

- The AI reads a KC's chunks with `getTopic` before it searches, so a dispute is only a `searchMaterials` test when the disputed KCs' own sources do not hold the evidence.
- The model often joins two passages of a chunk with `...` in `flagMap`'s quote; the tool refuses it and the model retries with one passage, which costs one more step in the reply.
- It sometimes agrees in text without calling `flagMap`: ask for a Finding in the Student's message.

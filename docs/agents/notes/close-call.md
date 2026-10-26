# Close call (#187)

Verified on 2026-10-26 on `xiaomi/mimo-v2.6-flash` through the gateway:

- Asked for a condensed Memory and a session note in one object, MiMo dropped or merged pinned lines when it wrote them late. The prompt asks for the pinned lines first, one per line; the guard (`keepsPinnedLines`) matches whole trimmed lines.
- Asked for a two-line session note in one string, it added a label ("Session note:") or ran the lines together. The schema has `happened` and `next` as two fields and the code joins them.

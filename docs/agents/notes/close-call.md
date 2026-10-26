# Close call (#187)

Verified on 2026-10-26 on `xiaomi/mimo-v2.6-flash` through the gateway:

- Asked for a condensed Memory and a session note in one object, MiMo dropped or merged pinned lines when it wrote them late. The prompt asks for the pinned lines first, one per line; the guard (`keepsPinnedLines`) matches whole trimmed lines.
- Asked for a two-line text (the session note, then the condensed Memory) with line breaks inside one string, it wrote one line or glued the lines together (`...confuse me.!The exam is...`). The schema has `happened`/`next` and `condensedLines` as separate strings and arrays, and the code joins them.

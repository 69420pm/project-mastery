# Close call (#187)

Verified on 2026-10-26 on `xiaomi/mimo-v2.6-flash` through the gateway:

- Asked for several lines with line breaks inside one string, it wrote one line or glued the lines together (`...confuse me.The exam is...`). The schema has `memoryLines` and `condensedLines` as arrays of strings, and the code joins them.

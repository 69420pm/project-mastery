-- A map Finding's quote must show something: refuse one that is only
-- whitespace, as `flagMap` does (#181).
alter table public.map_findings
  drop constraint map_findings_quote_check,
  add constraint map_findings_quote_check
    check (char_length(quote) between 1 and 500 and btrim(quote, E' \t\r\n') <> '');

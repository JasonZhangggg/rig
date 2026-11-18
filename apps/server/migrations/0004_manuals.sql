-- Manuals: the maker's own manual for each part of a PC, with its page text
-- for search and the chat.

-- What the finder found for a part, shared by every account: a manual's
-- address is public, so two people with the same board don't both pay for the
-- search. key is "kind|maker|model", lowercased. missed_at is when Rig last
-- looked and found nothing; it doesn't look again for 7 days.
create table manual_sources (
  key text primary key,
  url text,
  title text,
  host text,
  bytes integer,
  found_at timestamptz,
  missed_at timestamptz
);

-- One manual per part of a PC. Finding or adding again for the same part
-- replaces the old one and its pages.
create table manuals (
  id text primary key,
  user_id text not null,
  machine_id text not null,
  part text not null,
  kind text not null,
  maker text not null,
  model text not null,
  title text not null,
  url text,
  host text,
  source text not null,
  page_count integer,
  indexed boolean not null default false,
  diagrams jsonb not null default '[]',
  bytes integer,
  added_at timestamptz not null,
  unique (user_id, machine_id, part),
  foreign key (user_id, machine_id) references machine (user_id, id) on delete cascade
);

create index manuals_recent_idx on manuals (user_id, machine_id, added_at desc);

-- The text of each page. tsv holds the words twice: stemmed English, so
-- "connecting the fans" finds "connect a fan", and as written ('simple'), so
-- header names like CPU_FAN, F_PANEL, JRGB1 and M2_1 match exactly.
create table manual_pages (
  manual_id text not null references manuals (id) on delete cascade,
  n integer not null,
  text text not null,
  tsv tsvector generated always as (to_tsvector('english', text) || to_tsvector('simple', text)) stored,
  primary key (manual_id, n)
);

create index manual_pages_tsv_idx on manual_pages using gin (tsv);

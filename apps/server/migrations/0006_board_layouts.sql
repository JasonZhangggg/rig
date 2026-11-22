-- Board layouts read from motherboard manuals, shared by every account: the
-- drawing is the same for everyone with that board, so each model is read
-- once. key is boardKey(maker, model) from @rig/core. status is 'reading'
-- while one read runs (others wait for it), 'done' with the reading, or
-- 'failed' (Rig tries again after 7 days). The rest is what the read cost,
-- to watch the price and speed, and who sent the page, to trace a bad one.
create table board_layouts (
  key text primary key,
  maker text not null,
  model text not null,
  status text not null,
  page integer,
  reading jsonb,
  problem text,
  reader text,
  input_tokens integer,
  output_tokens integer,
  ms integer,
  read_by text,
  started_at timestamptz not null,
  updated_at timestamptz not null
);

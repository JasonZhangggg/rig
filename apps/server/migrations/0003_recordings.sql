-- Windows events the desktop app read from the PC (crashes, driver resets,
-- hardware errors, unexpected shutdowns, disk problems), newest first.
alter table machine add column events jsonb not null default '[]';

-- Recordings: a stretch of closer readings the chat or the person asked a PC
-- to keep. A request made on the web waits here as "pending" until that PC's
-- app picks it up at its next sync; the app uploads it as it runs and when it
-- finishes. info is the recording without its data; data holds samples and events.
create table recording (
  user_id text not null,
  machine_id text not null,
  id text not null,
  state text not null,
  info jsonb not null,
  data jsonb not null default '{"samples":[],"events":[]}',
  stop_requested boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, machine_id, id),
  foreign key (user_id, machine_id) references machine (user_id, id) on delete cascade
);

create index recording_recent_idx on recording (user_id, machine_id, created_at desc);

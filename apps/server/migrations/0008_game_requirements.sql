-- A game's requirements as Rig read them from its store or publisher page,
-- shared by every account: they're public, so two people asking about the
-- same game don't both pay for the lookup. key is the game's name in lower
-- case, letters and digits only. data is the GameRequirements Rig kept, null
-- when it looked and found nothing (missed_at); found ones are read again
-- after 30 days, misses after 7.
create table game_requirements (
  key text primary key,
  data jsonb,
  read_at timestamptz,
  missed_at timestamptz
);

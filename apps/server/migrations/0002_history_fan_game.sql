-- The desktop app now records the fastest fan (rpm) and the game in the
-- foreground for each history point. Points uploaded before that have neither.
alter table machine_history add column fan integer, add column game text;

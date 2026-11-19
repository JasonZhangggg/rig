-- Each part's own readings per history point: processor and graphics load,
-- memory in use (all percent, averaged over the window), and the warmest
-- drive and the motherboard (°C). Points uploaded before that have none.
alter table machine_history
  add column cpu_load integer, add column gpu_load integer, add column mem integer,
  add column drive integer, add column board integer;

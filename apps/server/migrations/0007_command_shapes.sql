-- How often each shape of general command was proposed, by day, so the next
-- recipe to add is the most common one. A shape holds only words from Rig's
-- own lists: the commands.json rows the change script uses ("other" for any
-- other command), the kinds of place it touches, and the verdict (its tier, or
-- refused and why). No script text, sentence, path, value, user or PC.
create table command_shapes (
  day date not null,
  shape text not null,
  count integer not null,
  primary key (day, shape)
);

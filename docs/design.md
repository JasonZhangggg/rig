# Lists in Rig

Every list of things that happened, or things to act on, reads like the Changes page. The pieces are in
`packages/ui/src/components/Rows.tsx` and `packages/ui/src/styles/rows.css`; use them rather than a new list style.

## The rules

1. **One item per line.** A bold title says what it is in plain words, and one grey line under it says who, how long or
   what kind. No third line: the rest goes behind Details.
2. **Time on the left, in its own column**, when the list is about when things happened. The titles then start in one
   straight line, so the eye runs down them.
3. **Grouped by day.** A small label over each day, "Today", "Yesterday" or the date, then how many: "2 changes".
   No rule above the label; hairlines only between the rows of a day.
4. **A timeline dot per row** when the list is a history: filled for something that happened, rust for something that
   needs a look, empty for something undone. A line joins the dots of a day.
5. **Buttons on the right, on the title's line.** Details first, then the row's one action, a verb: Undo, Ask,
   See change. Both are plain text buttons with no box, and no arrows or chevrons.
6. **Details opens in place**, under the title, never on another page: the why in a sentence, then the before and
   after or what Windows wrote.
7. **A chip only for the exception**, after the title: Undone, Ran hot, a newer driver. Ordinary rows carry no chip.
8. **A figure goes on the right** when the row is about a reading, with its word under it in grey: "75°C / graphics card".
9. **Filters are counts**, in the list's header on the right: "4 All · 3 Applied · 1 Undone".
10. **No boxes.** The list sits on the page, not in a card; whitespace and hairlines do the grouping.

## Where it doesn't fit

Dashboards (Home), charts, the chat and the parts shop are not lists of events and keep their own layouts. Settings,
the parts list on My PC and the games list already follow rules 1, 5 and 8.

# Buttons

A box (an outline or a fill, in the pill shape) is for the one main action of an area: Start recording, Add a PC,
Ask about game settings, the dark primary in a card. Every other action is a plain text button (`btn ghost`) that
only shows a background on hover: Not now, Cancel, Reset, Remove, Stop, Show more, a row's Details and its action.
Segmented choices, switches, status chips, count badges and filters keep their shapes, because the shape tells you
what they are. A toggle that's on (Heat, Exploded view, Customize Home) fills dark whether or not it had a box.

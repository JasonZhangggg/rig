# Making the 3D PC match the real one

Prototype on branch `claude/real-pc-3d`. Open `/proto/?build=north` (or `generic`, `atlas`, `o11`, `h5`; add `&ink` for the old drawn look), `/proto/?board=fp` (or `fan`, `m2`, `usb`, or any item id) and one part alone with `/proto/?part=gpu:asus-tuf-4070s-oc` (`cooler:noctua-nh-d15`, `ram:CMT64GX5M4B6000C30`; `&view=fans` turns a card over) with `pnpm dev:web`.

## How the parts are drawn

The PC view's "real" finish builds each part from its record plus a `look` that names the product's design:

- **`parts3d.ts`:** fans (frames, pads, swept blades, Axial-tech rings, TORX pairs, hub stickers), graphics cards (TUF, ROG Strix, Ventus, Founders Edition: backplate art and vents, fin stack, heatpipes, shroud trim, the lit name on the edge that faces the glass), tower coolers (NH-D15 beige and brown, Peerless Assassin), the LF3 pump and radiator, the Wraith, and memory (Vengeance, Vengeance RGB, Dominator).
- **`case3d.ts`:** cases (North walnut slats, O11 glass front, H5 Flow perforated front), glass, shroud, feet and the power supply.
- **`board3d.ts`:** the board itself (printed traces, silkscreen names, plated holes, power stage parts) and every slot and header, shared by the tower and the board view.
- **The board view (`boardScene.ts`):** uses the app's own part labels. One header with named pins gets a pin map beside the board, colored by what plugs in, with the same colors on the pins in 3D.

Everything is drawn from code and canvas textures; no model files or maker artwork.

## Recommendation

Build each part in code from a small record of its real size and features, and find the record from what Windows reports plus one tap from the person for what it can't see. Don't ship maker CAD files or a library of hand-made models.

- **How it draws:** `scene.ts` builds the tower from `pc.build` (`core/src/build.ts`): the case's real size, front and layout, the board's own layout (so the card sits in PCI_E1 and the sticks in the slots Windows names), the card's length, height, thickness and fan count, the cooler's kind and height, and the memory's height.
- **Where shapes come from,** shown per part: detected, picked, catalog, estimated (the chip but not the card), generic.
- **Board view:** `boardScene.ts` draws the board from the same layout record, lights a kind or one header, and names each pin.

## What the tests showed

| | Spec records (prototype) | Maker CAD or a model library |
| --- | --- | --- |
| Data per part | about 170 bytes; all code and records 3.6 KB gzipped, a board layout 1.3 KB | a CAD-detail part is about 300,000 triangles, 8.5 MB raw |
| Whole PC, software rendering 1200×800 | 30k triangles, 285 ms a frame today; 41k and 310 ms (North build); 58k and 400 ms (O11 with 10 fans) | one 300k part alone 220 ms, five parts (1.5M) 860 ms and 42 MB, before shadows and outlines |
| Availability | sizes are on makers' spec pages | ASUS, MSI and Gigabyte don't publish card CAD; models on CAD sites are user-made with licenses that don't allow shipping them |
| Look | matches Rig's ink style | photoreal parts clash with it |

Software rendering is the worst case (a PC without a graphics driver); on a real graphics card all of these run at full speed, so the numbers compare cost, not speed.

Detection:
- **Board:** Windows gives the exact product, enough to pick its layout record.
- **Memory:** the part number names the kit. Corsair's prefixes map straight to height (CMK 35 mm, CMH 44 mm, CMT 56 mm, from Corsair's own table). Other makers' sticks may report a shorter part number than the box; check on real PCs.
- **Graphics card:** Windows names the chip, not the card. The PCI subsystem vendor (1043 ASUS, 1462 MSI, 10DE NVIDIA) names the card's maker; the public PCI ID list has almost no subsystem entries for RTX 40 and 50 cards, so Rig needs its own table or one tap: "Which ASUS 4070 SUPER is it?" with that maker's few cards. The helper reads PNPDeviceID but doesn't pass it on yet.
- **Case, cooler, power supply:** invisible to Windows. NZXT and Corsair liquid coolers show up as USB devices (not tested yet).
- **Sizes:** makers list them but in different orders and places (ASUS keeps them off the main page; MSI writes 242 x 125 x 43 mm with no axis names). Don't copy TechPowerUp's or PCPartPicker's databases.

## Board layouts

The layout record is the expensive part: about 35 items per board in mm. The prototype's Tomahawk layout is placed by hand from the ATX rules and the board's header names, so it can be 10 mm out. The real source is the manual's "Overview of Components" page, which Rig already finds (MSI: page 24 of the B650M Mortar guide, 28 of the X870 Tomahawk). Tested on the MSI PRO B650-A WIFI manual (page 27): the drawing is to scale (its sides measure 1.25 to 1, the same as 305 by 244 mm, within 0.5%), the spacing from PCI_E1 to PCI_E2 measures 61.0 mm against the 60.96 mm the rules give, and every header carries its printed name, so traced positions land within about 2 to 3 mm. A person still checks an overlay before a record ships. Boards without a record get a typical layout for their size.

## Reading layouts from manuals

Rig reads each board model's layout from its manual once, for everyone, without the person asking.

- **When:** as soon as a signed-in PC shows its board (`useBoardLayout` in `ui/src/manuals/boardLayout.ts`). It stops at the first place that has the layout: this device, then the server's record for that board model, then the manual (found once for everyone, read once per PC), whose layout page the app renders and the server reads.
- **Once:** the server keeps one record per board model (`board_layouts`, keyed by `boardKey`, so "Micro-Star ... PRO B650-A WIFI (MS-7D78)" and "MSI pro b650-a wifi" share it). A second PC asking while the first read runs gets "reading" and waits for it. A drawing it couldn't read is retried after 7 days; an API failure is retried by the next PC.
- **Reader:** Opus 5.5, effort low, one picture of the page with its white margins cut, long side at most 1568 px, plus that page's and the next page's text (ASRock numbers its callouts and names them on the next page). It answers in the picture's pixels; `layoutFromReading` scales them to the board's standard size.
- **Trust:** only a motherboard manual found on the maker's site is read, and the board comes from that manual, not the request. The picture is still rendered by the app, so the record keeps who sent it (`read_by`) to find and drop a bad one.
- **See one:** `/proto/?board=&read=msi` or `&read=asrock` draws a real reading.

Tuning, on four makers' drawings (MSI PRO B650-A, ASUS TUF B650M-PLUS, Gigabyte X570S AORUS ELITE, ASRock B650M Pro RS) against 10 positions per board traced by hand:

| Reader | Found | Mean error | Worst board | Answer size |
| --- | --- | --- | --- | --- |
| Opus, millimetres (first try) | 40/40 | 1.4 mm | 1.6 mm | 3.4 KB |
| Opus, pixel boxes | 40/40 | 1.4 mm | 1.8 mm | 3.3 KB |
| Opus, pixel boxes over a drawn grid | 40/40 | 1.4 mm | 1.8 mm | 3.3 KB |
| **Opus, short arrays (kept)** | 40/40 | 1.4 mm | 1.8 mm | **1.6 KB** |
| Sonnet, pixel boxes | 39/40 | 2.4 mm | 3.1 mm | 2.9 KB |
| Sonnet, grid | 40/40 | 2.1 mm | 3.0 mm | 3.2 KB |
| Haiku, grid | 38/40 | 5.3 mm | 11.8 mm | 2.9 KB |

The hand tracing itself is good to about 1 mm, so Opus is at the limit this test can see. Pixel boxes were kept over millimetres because millimetres rely on the model knowing the board's size. Not measured here (no API key in the test setup): real seconds per read, and whether effort low loses accuracy against the default; check both with the first real reads (`board_layouts.ms`, tokens).

## Rough scope

1. About a week: build `pc.build` from the inventory, pass the PCI ids from the helper, store each PC's picks, add "Which case, cooler and card is it?" to the Parts tab, polish the pieces (instanced fins to cut draw calls), seed about 60 records.
2. One to two weeks: the board view in Parts and Manuals, linked from chat ("where does the power switch cable go?"), a tracing tool, the 20 most common boards.
3. Later: the server looks up an unknown model once from the maker's page and shares the record; detect liquid coolers over USB; laptops.

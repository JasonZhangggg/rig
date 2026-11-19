# My PC tabs and Upgrades: feature map

My PC gets three tabs, each its own address so a link opens the right one:
**Parts** (`#pc`, the 3D view as it is), **Upgrades** (`#upgrades`) and **Manuals** (`#manuals`).

## What each tab answers at a glance

| Tab | The glance | Then |
| --- | --- | --- |
| Parts | Which part is which, and is anything running hot | Pick a part: readings, specs, its manual, drivers |
| Upgrades | What would help this PC most, and what fits it | Browse parts that fit, compare prices, build a list |
| Manuals | Which manuals Rig has, and find a page fast | Open a diagram, add a missing manual, check drivers and BIOS |

## Upgrades: what PCPartPicker does, and what Rig does with it

PCPartPicker's core is a part catalog by category with filters, a compatibility checker,
an estimated wattage, prices from several retailers, price history, price alerts and saved lists.
Rig starts from a different place: it already knows the real parts inside the PC, so the
"build" is the PC you own and every check runs against it.

| Feature | PCPartPicker | Rig, this round | Rig, later |
| --- | --- | --- | --- |
| Categories | Every part type | Memory, Storage, Graphics card, Processor, CPU cooler, Case fans, Power supply. A laptop shows only what can be changed | Monitors, cases |
| Compatibility | Rules between the parts you pick | Rules against the parts Rig read: CPU socket, DDR4 vs DDR5, free memory slots, matching your kit, free M.2 slots, BIOS date for newer CPUs, laptop memory soldered | Case clearance once the case model is known |
| Things Windows can't see | n/a, you pick every part | Says so instead of guessing: card length vs case and cooler height are "Check first". Power supply wattage is one question, asked once | Read the case and PSU from the manual Rig found |
| Wattage | Estimated from part specs | Estimate from typical draw of your CPU, GPU and the rest, and the change each part makes. Checked against your PSU once you tell Rig its wattage | Measured peak draw from Rig's power sensors over 30 days |
| Prices | Live, many retailers | **Demo prices, labeled on every screen.** Lowest price, three demo shops, in stock or not | A real feed (see below) |
| Price history | Chart per part | 12-week demo sparkline with low and high | Real history from the feed |
| Price alerts | Email on a drop | Not built | A watch that tells you in Rig |
| Saved lists | Yes, shareable | "Your list" per PC on this device: total, power change, ask Rig to check it | Sync with the account |
| Ratings and reviews | Yes | Not shown. Rig has no source, and made-up ratings would mislead | Only from a real source |
| Spec deltas | Side by side | "vs yours" on each row: 64 GB vs your 32 GB, 16 GB VRAM vs 12 GB | Measured gains from benchmarks |
| Free fixes first | n/a | If something costs nothing (a monitor stuck at 60 Hz), it shows before any part | More checks from Rig's health list |
| Rig's pick | n/a | The idea that answers something Rig read on this PC, with the parts for it one click away | Bottleneck hints from busy-time readings (GPU at 99% while the CPU idles) |
| Used vs new | No | Not built | Used listings, if a source allows it |

## Where real prices would come from

None of these are wired up. Each needs an account, an agreement or both.

- **Affiliate and product APIs.** Amazon's Product Advertising API gives prices for linked items, but access depends on an active Associates account with recent sales. Best Buy has a public Products API with a free key. Newegg and B&H run affiliate programs with product feeds through networks like CJ or Impact, again after approval.
- **Price aggregators.** Some sell a price feed for PC parts. PCPartPicker itself has no public API.
- **Scraping.** Retailer terms usually forbid it, pages change often and bot checks block it. Not a basis for a product.
- **What Rig would need either way:** a server job that refreshes prices a few times a day, matches feed items to Rig's part list by model number, keeps price history, and shows "Price from {shop}, {time}" on every price. Links out would be affiliate links, which have to be disclosed.

Until then, every price in the app sits under a "Demo prices" label, and the demo shops have made-up names (Northwind, Contoso Parts, Fabrikam).

## Manuals tab

- Search every manual at the top. Results show the page and the words around the match.
- One card per part: the manual's state and one next step (Open, Find manual, Add a PDF). Diagrams open at their page.
- Drivers and BIOS: installed vs latest for each part that has one, with the maker's download page. Rig never installs them.
- Add a manual for something Windows can't see, like a monitor or the case.

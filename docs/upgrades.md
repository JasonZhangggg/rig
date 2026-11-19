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
| Search and filters | Search, plus filters for every spec | Search each kind of part by name, maker, spec or part number ("64gb" matches "64 GB"). Maker chips. Matches in other kinds are named with a link. Sort by best fit or price | Spec filters (speed, capacity, wattage) once the catalog is big enough to need them |
| A part that isn't listed | Custom part with your own price | "Add a part Rig doesn't list": a name and an optional price, on your list marked Not checked | Rig looks the model up and checks it |
| Photos | Product photos | A slot for one on every row, detail and list line. The demo shows the kind of part's icon and says "No photo yet" | Photos from the shop feed, which licenses them |
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

## Real photos and prices: Best Buy

Checked November 2026. Best Buy's Products API is the one feed Rig can use today:

- **Sign-up:** a free key from developer.bestbuy.com with an email address. No sales or approval needed for the Products API.
- **Limits:** 50,000 calls a day, 5 a second. Rig makes about 28 calls every 12 hours.
- **Photos:** allowed next to Best Buy's listing, unchanged (resizing is fine), with Best Buy named as the source and its logo on the screen. Content may be kept up to 72 hours; Rig keeps it 12, in the server's memory.
- **Key:** may not be shared, so it stays on the server as `BESTBUY_API_KEY` and the apps never see it.
- **Open questions for Best Buy:** the licence is for apps "in connection with offers to sell or sales" of its products, and bars using its prices to benefit other retailers. Showing only Best Buy's listing with a link to buy it fits that; putting it beside other shops' prices needs Best Buy's written OK first.

How it works: `apps/server/src/retail.ts` looks each catalog part up by maker and model, keeps a listing only when its name has the same model, size and memory type, and replaces that part's demo price and photo. Parts it can't match stay marked demo. Still to do once there's a key: add Best Buy's logo from its brand kit next to "Photos and prices marked Best Buy come from Best Buy", and check the matches against real listings.

Ruled out for now:

- **Amazon:** the Product Advertising API was switched off in May 2026. Its replacement, the Creators API, needs an Associates account with 10 sales in the last 30 days.
- **Icecat (free product data with photos):** photos are only for brands that sponsor it, each brand can withdraw them, use has to promote the brand, and its licence bars using the data with AI, which Rig's chat does.
- **Newegg, B&H and other affiliate networks:** need approval for an affiliate account first, and their feeds' photo terms vary.

## Where a full catalog and photos would come from

The demo catalog has 28 parts. A real one needs thousands, kept current, and the same feeds that give prices give the catalog:

- **Retailer and affiliate feeds** (Best Buy's Products API, Newegg and B&H through CJ or Impact, Amazon's Product Advertising API) list each product with its brand, model number, specs and a product photo the feed licenses for showing next to its price. That is the only photo source Rig plans to use.
- **Matching:** the server matches feed items to Rig's kinds of part by category and model number, and fills `maker`, the specs the fit rules need (`is` in `packages/core/src/shop.ts`) and `image`. Parts missing a fit-critical spec, like memory without its type, are left out rather than guessed.
- **Not used:** photos copied from makers' or shops' sites, or linked straight from them. Their terms usually don't allow it, and the links break.
- **Search stays the same:** `matchesQuery` works on the same fields a feed fills, so a bigger catalog needs no change to the screen. Past a few hundred parts per kind, search would move to the server.

## Manuals tab

- Search every manual at the top. Results show the page and the words around the match.
- One card per part: the manual's state and one next step (Open, Find manual, Add a PDF). Diagrams open at their page.
- Drivers and BIOS: installed vs latest for each part that has one, with the maker's download page. Rig never installs them.
- Add a manual for something Windows can't see, like a monitor or the case.

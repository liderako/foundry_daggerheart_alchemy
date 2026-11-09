# The Mist Age - Alchemy

A Daggerheart module for Foundry VTT: potion crafting by recipe.

- The GM keeps a **recipe book** and decides which recipes each character knows.
- A character who can brew opens the **alchemy window**, picks a known recipe, puts in the ingredients and a vessel (a vial, a bottle of alcohol) and makes a Knowledge action roll against the recipe's difficulty.
- The ingredients and the vessel are spent, and the potion goes into the character's inventory.

## Recipe book (GM)

Module settings → *Open the recipe book*, or *Alchemy settings → Recipe book* in a character sheet's header menu.

**Recipes.** Drop a potion item (from the Items sidebar or a compendium) to add its recipe. In the recipe:

- **Potion** — the item the character gets.
- **Enhanced version** — the item given on a critical success. Without one the character gets the ordinary potion and the chat card tells the GM to decide how it is stronger.
- **Outcome variants** — see below.
- **Rarity** sets the difficulty: Common 12, Uncommon 14, Rare 16, Legendary 18, or a custom number.
- **Ingredients**: a number of *any* alchemy ingredients (3 by default) and/or particular ingredients with their amounts.

**Ingredients and vessels.** Drop the items that count as alchemy ingredients and the items that can hold a potion. Items are matched by name, so the copies already in inventories count without any marking.

Dropping an Items folder adds every item in it. An item can also be marked from its own sheet's header menu (*Alchemy: mark as an ingredient / a vessel*).

## Characters (GM)

**Alchemy panel.** The *Alchemy* button at the top of the Actors sidebar tab (next to *Create Actor*) opens *Alchemy: characters*: every player character with a brewing on/off checkbox, how many recipes they know, research projects and recognised results, and buttons to their alchemy settings, alchemy window and recognised results, plus the recipe book. With The Mist Age - Learn Projects active, it also shows each character's active learn projects and a button to them. No need to open the sheets. (Macro: `game.modules.get("mist-age-alchemy").api.hub()`.)

*Alchemy settings* in a character sheet's header menu: turn *Can brew potions* on and tick the recipes the character knows.

The GM can also do it right in a character's alchemy window: it shows the whole book, with a checkbox by each recipe for "this character knows it" (the player sees only the ticked ones). Below the character's ingredients the GM sees the other consumables and loot, with buttons to mark them as ingredients or vessels; dropping an unmarked item onto the table asks what it is.

**Recognised results.** *Set up* under *Recognised results* opens a window of the hidden by-products the character already knows. Each recipe is one folded line with a count (the character's own recipes first, a search box on top); unfolded, it is a table: a row for the plain recipe and one per alcohol, against the three hidden outcomes, a checkbox and the potion's icon in each cell (hover for its name; click a row's name to tick the whole row). A ticked combination comes out identified instead of hidden; knowing "stamina + cider on a Failure with Fear" does not reveal the same potion from wine. These are not recipes: they do not appear in the alchemy window and cannot be brewed on purpose. (A potion whose recipe the character knows is always recognised.)

## Brewing

The flask button next to the rest buttons on the character sheet (or *Alchemy* in the sheet's header menu), shown only when the character can brew (to the owner and the GM). Pick a recipe, then drag ingredients from the sheet or from the list on the right onto the table (when more than one unit fits, a small window asks how many, from 1 to all that fit; hold Shift to put in all that fit at once; click a slot to take one out) and a vessel onto the vessel slot. *Brew* opens the usual Daggerheart roll dialog, so Experiences and other bonuses apply as in any action roll; Hope and Fear are applied as usual.

| Roll | Result |
| --- | --- |
| Critical success | the enhanced potion |
| Success with Hope | the recipe potion |
| Success with Fear | its variant, hidden (otherwise the recipe potion) |
| Failure with Hope | its variant, hidden (otherwise the recipe potion) |
| Failure with Fear | its variant, hidden (otherwise the recipe potion) |

**Outcome variants.** In the recipe editor the GM can drop a potion for Success with Fear, Failure with Hope and Failure with Fear. Such a potion is given *hidden*, as a mystery item of The Mist Age - Equipment: unidentified, going by the recipe potion's name and picture, with its description and features concealed and its effects off. Players cannot use it until the GM identifies it (the item's settings tab, or the Unidentified tag in the inventory). The GM gets a whisper naming the real potion. Without the Equipment module the variant is given as it is. A character who knows the recipe of the potion that came out (for example, knows Poison and gets Poison on a failed stamina brew) recognises it: it is given identified, and the chat card says so.

**Mixing with alcohol.** In the recipe editor, drop a bottle of alcohol under *Mixing with alcohol* to give the recipe a separate outcome table for that alcohol (the bottle is also marked as a vessel). When a character brews with that bottle as the vessel, the outcome is read from its table: the recipe potion on this alcohol, its critical, and the three variants. On alcohol **every** outcome comes out hidden (under the recipe potion's name) until the character knows that combination (see *Recognised results*); without alcohol only the three by-products are. An empty slot gives the recipe potion (the table's own potion if set, otherwise the recipe's). Each alcohol has its own table; a vial or an alcohol without a table uses the recipe's usual outcomes. The alchemy window and the chat card show when a mix is in play.

**Forbidding alcohol.** In the materials tab, the wine-glass toggle marks a vessel as alcohol (a bottle dropped under *Mixing with alcohol* is marked automatically). A recipe with *Forbid mixing with alcohol* ticked refuses those vessels: the alchemy window shows them crossed out and does not take them, so only a vial or another non-alcohol vessel fits.

Every outcome spends the ingredients and the vessel. Closing the roll dialog spends nothing.

The roll trait is a world setting (Knowledge by default).

## Research

The alchemy window has a second tab, **Research**, for learning a recipe from a sample.

- The list shows the book's recipes the character does not know yet and either has an identified sample of in the inventory or has already started (the GM sees the same list).
- The **first attempt** needs a sample of the potion in the inventory and spends it along with the ingredients, whatever the roll (closing the roll dialog spends nothing). Later attempts need no sample.
- **Every attempt** spends 3 alchemy ingredients of any kind (put them on the table as for brewing; no vessel) and makes a Knowledge action roll (the brewing trait setting) against the research difficulty.
- The project's counter starts full and counts **down**: critical −3, success with Hope −2, success with Fear −1, failure with Hope 0, failure with Fear +1 (never above the start). Hope and Fear from the roll apply as usual.
- At 0 the character learns the recipe; a chat card reports every attempt.

By rarity the research takes:

| Rarity | Difficulty | Counter |
| --- | --- | --- |
| Common | 12 | 6 |
| Uncommon | 14 | 8 |
| Rare | 16 | 14 |
| Legendary | 18 | 16 |

The GM can set a recipe's own research difficulty and starting counter in the recipe editor (*Research*; empty goes by rarity), and see, edit (the number is what is left) or drop a character's projects in their alchemy settings.

## Resources on use

An item can give its user resources whenever one of its actions is used, for what a Daggerheart action cannot do by itself (an attack with a reaction roll cannot also grant Hope). Set the flag `flags.mist-age-alchemy.onUse` on the item, e.g. `{ "hope": 1 }`; keys are `hope`, `stress`, `hitPoints` and `fear` (the GM's Fear), positive values add and negative ones remove, clamped to the resource's range. A short chat line reports the change.

## Free actions

With The Mist Age - Free Actions active, every brewing and every recipe research attempt spends one of the character's free actions (none at 0, nothing is blocked), and the roll button shows how many are left.

## Macro API

```js
game.modules.get("mist-age-alchemy").api.craft();          // the selected token's or the user's character
game.modules.get("mist-age-alchemy").api.craft(actor);
game.modules.get("mist-age-alchemy").api.recipeBook();     // GM
game.modules.get("mist-age-alchemy").api.configure(actor); // GM
```

## Install

Manifest URL:

```
https://github.com/liderako/foundry_daggerheart_alchemy/releases/latest/download/module.json
```

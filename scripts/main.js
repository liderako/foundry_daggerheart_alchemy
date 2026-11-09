import { MODULE_ID, canCraft, getKnownRecipes, isIngredient, isVessel, refreshSnapshots, registerSettings, setMaterial } from "./data.js";
import { ActorConfig } from "./actor-config.js";
import { CraftWindow } from "./craft-window.js";
import { RecipeBook, RecipeEditor } from "./recipe-book.js";
import { registerOnUse } from "./on-use.js";
import { registerLearnByDrinking } from "./learn-by-drinking.js";
import { registerPartySetting } from "./party-config.js";
import { AlchemyHub } from "./gm-hub.js";

/** The alchemy entries in a character sheet's header menu: brewing for whoever can, the settings for the GM. */
function addHeaderControls(app, controls) {
	const actor = app.document;
	if (actor?.documentName !== "Actor" || actor.type !== "character") {
		return;
	}
	if (game.user.isGM || (actor.isOwner && canCraft(actor))) {
		controls.unshift({
			icon: "fa-solid fa-flask-vial",
			label: "MIST_ALCHEMY.Controls.Craft",
			action: `${MODULE_ID}-craft`,
			onClick: () => CraftWindow.show(actor)
		});
	}
	if (game.user.isGM) {
		controls.unshift({
			icon: "fa-solid fa-flask",
			label: "MIST_ALCHEMY.Controls.Settings",
			action: `${MODULE_ID}-settings`,
			onClick: () => ActorConfig.show(actor)
		});
	}
}

/** GM: mark or unmark an item as an alchemy ingredient or a vessel from its sheet's header menu. */
function addItemHeaderControls(app, controls) {
	const item = app.document;
	if (!game.user.isGM || item?.documentName !== "Item" || !["consumable", "loot"].includes(item.type)) {
		return;
	}
	const ingredient = isIngredient(item);
	const vessel = isVessel(item);
	controls.unshift(
		{
			icon: ingredient ? "fa-solid fa-square-check" : "fa-solid fa-mortar-pestle",
			label: ingredient ? "MIST_ALCHEMY.Controls.UnmarkIngredient" : "MIST_ALCHEMY.Controls.MarkIngredient",
			action: `${MODULE_ID}-ingredient`,
			onClick: () => setMaterial("ingredients", item, !ingredient)
		},
		{
			icon: vessel ? "fa-solid fa-square-check" : "fa-solid fa-wine-bottle",
			label: vessel ? "MIST_ALCHEMY.Controls.UnmarkVessel" : "MIST_ALCHEMY.Controls.MarkVessel",
			action: `${MODULE_ID}-vessel`,
			onClick: () => setMaterial("vessels", item, !vessel)
		}
	);
}

/** The settings menu button: opens the one recipe book instead of a new window per click. */
class RecipeBookMenu extends foundry.applications.api.ApplicationV2 {
	async render() {
		return RecipeBook.show();
	}
}

/** The character a user brews as: the selected token's, otherwise the user's own character. */
function defaultActor() {
	return canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
}

Hooks.once("init", () => {
	registerSettings();
	registerOnUse();
	registerLearnByDrinking();
	registerPartySetting();
	game.settings.registerMenu(MODULE_ID, "recipeBook", {
		name: "MIST_ALCHEMY.Settings.Book.Name",
		label: "MIST_ALCHEMY.Settings.Book.Label",
		hint: "MIST_ALCHEMY.Settings.Book.Hint",
		icon: "fa-solid fa-book-skull",
		type: RecipeBookMenu,
		restricted: true
	});
	foundry.applications.handlebars.loadTemplates([
		`modules/${MODULE_ID}/templates/craft.hbs`,
		`modules/${MODULE_ID}/templates/recipe-book.hbs`,
		`modules/${MODULE_ID}/templates/recipe-editor.hbs`,
		`modules/${MODULE_ID}/templates/actor-config.hbs`,
		`modules/${MODULE_ID}/templates/recognised.hbs`,
		`modules/${MODULE_ID}/templates/hub.hbs`
	]);
});

Hooks.once("ready", () => {
	game.modules.get(MODULE_ID).api = {
		/** Opens the alchemy window of a character (default: the selected token's or the user's character). */
		craft: (actor = defaultActor()) => CraftWindow.show(actor),
		/** GM: the recipe book. */
		recipeBook: () => RecipeBook.show(),
		/** GM: the alchemy panel of all player characters. */
		hub: () => AlchemyHub.show(),
		/** GM: one recipe's editor. */
		editRecipe: id => RecipeEditor.show(id),
		/** GM: a character's alchemy settings. */
		configure: actor => ActorConfig.show(actor),
		knownRecipes: actor => getKnownRecipes(actor)
	};
	refreshSnapshots();
});

/** GM: a button in the Actors sidebar header, next to "Create Actor", opens the alchemy panel of all player characters. */
function addDirectoryButton(app, element) {
	if (!game.user.isGM) {
		return;
	}
	const root = element instanceof HTMLElement ? element : element?.[0];
	const actions = root?.querySelector(".header-actions");
	if (!actions || actions.querySelector(".mist-alchemy-hub-button")) {
		return;
	}
	const button = document.createElement("button");
	button.type = "button";
	button.classList.add("mist-alchemy-hub-button");
	button.innerHTML = `<i class="fa-solid fa-flask" inert></i> ${game.i18n.localize("MIST_ALCHEMY.Hub.Button")}`;
	button.addEventListener("click", event => {
		event.preventDefault();
		AlchemyHub.show();
	});
	actions.append(button);
}

function sheetButton(cls, icon, tooltip, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.classList.add(cls);
	button.dataset.tooltip = game.i18n.localize(tooltip);
	button.innerHTML = `<i class="fa-solid fa-fw ${icon}" inert></i>`;
	button.addEventListener("click", event => {
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
	return button;
}

/**
 * A flask next to the rest buttons on a character sheet opens the alchemy window, when the character can brew (for
 * the owner and the GM). Learn projects have their own module and button.
 */
function addSheetButton(sheet, element) {
	const actor = sheet.document;
	if (actor?.type !== "character") {
		return;
	}
	const section = element.querySelector(".downtime-section");
	if (!section) {
		return;
	}
	const gm = game.user.isGM;
	// Brewing only for a character who can brew, for the GM too (the GM's alchemy panel reaches the others).
	const craft = canCraft(actor) && (gm || actor.isOwner);
	toggleSheetButton(section, craft, "mist-alchemy-sheet-button", () => sheetButton("mist-alchemy-sheet-button", "fa-flask-vial", "MIST_ALCHEMY.Controls.Craft", () => CraftWindow.show(actor)));
}

/** Adds the button when it should be there and is not, removes it when it should not be (brewing turned off). */
function toggleSheetButton(section, show, cls, make) {
	const existing = section.querySelector(`.${cls}`);
	if (show && !existing) {
		section.append(make());
	} else if (!show && existing) {
		existing.remove();
	}
}

Hooks.on("renderActorDirectory", addDirectoryButton);
Hooks.on("renderActorSheetV2", addSheetButton);
Hooks.on("getHeaderControlsActorSheetV2", addHeaderControls);
Hooks.on("getHeaderControlsItemSheetV2", addItemHeaderControls);

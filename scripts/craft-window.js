import {
	CHANGED_HOOK, MODULE_ID, canCraft, getDifficulty, getKnownRecipeIds, getMix, isVessel, getKnownRecipes, getQuantity, getTrait, listRecipes,
	listResearchable, setMaterial, setRecipeKnown
} from "./data.js";
import { brew, canPlace, evaluate, isUsableIngredient, isUsableVessel, research, researchState, researchTable } from "./crafting.js";
import { bindDragSources, bindDropZones } from "./drag.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Item types that can be ingredients or vessels; the GM is offered these to mark. */
const MATERIAL_TYPES = new Set(["consumable", "loot"]);

/**
 * The character's alchemy table: pick a known recipe, put ingredients and a vessel in (drag them from the sheet
 * or from the list on the right, or click them), then brew.
 */
export class CraftWindow extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-alchemy", "mist-alchemy-craft"],
		window: { icon: "fa-solid fa-flask-vial", resizable: true },
		position: { width: 760, height: 560 },
		actions: {
			selectRecipe: CraftWindow.#onSelectRecipe,
			place: CraftWindow.#onPlace,
			unplace: CraftWindow.#onUnplace,
			setVessel: CraftWindow.#onSetVessel,
			clearVessel: CraftWindow.#onClearVessel,
			clearAll: CraftWindow.#onClearAll,
			brew: CraftWindow.#onBrew,
			toggleKnown: CraftWindow.#onToggleKnown,
			markIngredient: CraftWindow.#onMarkIngredient,
			markVessel: CraftWindow.#onMarkVessel,
			switchTab: CraftWindow.#onSwitchTab,
			selectResearch: CraftWindow.#onSelectResearch,
			research: CraftWindow.#onResearch
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/craft.hbs` }
	};

	static #instances = new Map();

	static show(actor) {
		if (!actor) {
			ui.notifications.warn("MIST_ALCHEMY.Craft.NoActor", { localize: true });
			return null;
		}
		if (!canCraft(actor) && !game.user.isGM) {
			ui.notifications.warn("MIST_ALCHEMY.Craft.Disabled", { localize: true });
			return null;
		}
		let app = CraftWindow.#instances.get(actor.uuid);
		if (!app) {
			app = new CraftWindow(actor);
			CraftWindow.#instances.set(actor.uuid, app);
		}
		app.render({ force: true });
		return app;
	}

	static refreshAll(actor = null) {
		for (const app of CraftWindow.#instances.values()) {
			if (app.rendered && (!actor || app.actor === actor)) {
				app.render();
			}
		}
	}

	constructor(actor, options = {}) {
		super({ ...options, id: `${MODULE_ID}-craft-${actor.id}` });
		this.actor = actor;
		this.recipeId = null;
		/** @type {Map<string, number>} item id → units put in */
		this.placed = new Map();
		this.vesselId = null;
		this.busy = false;
		/** "brew" or "research" */
		this.tab = "brew";
		this.researchId = null;
	}

	get title() {
		return game.i18n.format("MIST_ALCHEMY.Craft.Title", { actor: this.actor.name });
	}

	/** The recipes shown on the left: the known ones, or for the GM the whole book. */
	#recipes() {
		return game.user.isGM ? listRecipes() : getKnownRecipes(this.actor);
	}

	get recipe() {
		return this.#recipes().find(recipe => recipe.id === this.recipeId) ?? null;
	}

	/** The recipe being researched on the research tab. */
	get researchRecipe() {
		return listResearchable(this.actor).find(recipe => recipe.id === this.researchId) ?? null;
	}

	/** What the ingredient table is filled for: the recipe to brew, or the research attempt (any ingredients, no vessel). */
	get table() {
		return this.tab === "research" ? researchTable(this.researchRecipe) : this.recipe;
	}

	/** Drops what is no longer there: removed items, used-up quantities, a recipe the character forgot. */
	#prune() {
		const recipes = this.#recipes();
		if (!recipes.some(recipe => recipe.id === this.recipeId)) {
			this.recipeId = recipes[0]?.id ?? null;
			if (this.tab === "brew") {
				this.placed.clear();
			}
		}
		const researchable = listResearchable(this.actor);
		if (!researchable.some(recipe => recipe.id === this.researchId)) {
			this.researchId = researchable[0]?.id ?? null;
			if (this.tab === "research") {
				this.placed.clear();
			}
		}
		for (const [itemId, units] of this.placed) {
			const item = this.actor.items.get(itemId);
			if (!item) {
				this.placed.delete(itemId);
			} else if (units > getQuantity(item)) {
				this.placed.set(itemId, getQuantity(item));
			}
		}
		const vessel = this.vesselId ? this.actor.items.get(this.vesselId) : null;
		if (this.tab === "research" || !vessel || !isUsableVessel(vessel, this.recipe)) {
			this.vesselId = null;
		}
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		this.#prune();
		const recipe = this.recipe;
		const traitLabel = game.i18n.localize(`DAGGERHEART.CONFIG.Traits.${getTrait()}.name`);
		context.actor = this.actor;
		context.enabled = canCraft(this.actor);
		context.isGM = game.user.isGM;
		context.busy = this.busy;
		context.traitLabel = traitLabel;
		context.tab = this.tab;
		context.research = this.#researchContext();
		const known = new Set(getKnownRecipeIds(this.actor));
		context.recipes = this.#recipes().map(entry => ({
			id: entry.id,
			name: entry.name,
			img: entry.img,
			difficulty: getDifficulty(entry),
			known: known.has(entry.id),
			selected: entry.id === this.recipeId
		}));
		context.knownCount = context.recipes.filter(entry => entry.known).length;
		context.recipe = null;
		if (recipe) {
			const state = evaluate(recipe, this.actor, this.placed);
			const placedItems = [];
			for (const [itemId, units] of this.placed) {
				const item = this.actor.items.get(itemId);
				if (item && units > 0) {
					placedItems.push({ id: itemId, name: item.name, img: item.img, units });
				}
			}
			const empty = Math.max(0, state.requirement.total - state.count);
			const vessel = this.vesselId ? this.actor.items.get(this.vesselId) : null;
			const mix = getMix(recipe, vessel);
			context.recipe = {
				...recipe,
				difficulty: getDifficulty(recipe),
				// On alcohol every outcome is hidden from the player: only the GM sees what the table gives.
				enhancedName: (mix ? (game.user.isGM ? mix.enhanced?.name : null) : recipe.enhanced?.name) ?? null,
				mix: mix ? { vessel: mix.vessel, resultName: game.user.isGM ? (mix.result?.name ?? recipe.name) : null } : null,
				named: state.named.map(entry => ({ ...entry, done: entry.have >= entry.quantity })),
				any: state.requirement.any,
				anyHave: state.anyHave,
				anyDone: state.anyHave >= state.requirement.any,
				total: state.requirement.total,
				count: state.count,
				placedItems,
				emptySlots: Array.from({ length: empty }),
				vessel: vessel ? { id: vessel.id, name: vessel.name, img: vessel.img } : null,
				ready: state.ready && !!vessel
			};
		}
		context.ingredients = [];
		context.vessels = [];
		context.others = [];
		const table = this.table;
		for (const item of this.actor.items) {
			const quantity = getQuantity(item);
			const used = (this.placed.get(item.id) ?? 0) + (item.id === this.vesselId ? 1 : 0);
			const entry = { id: item.id, uuid: item.uuid, name: item.name, img: item.img, left: quantity - used, quantity };
			if (isUsableIngredient(table, item)) {
				entry.canPlace = !!table && entry.left > 0 && canPlace(table, this.actor, this.placed, item);
				context.ingredients.push(entry);
			}
			if (this.tab === "brew" && isVessel(item)) {
				entry.blocked = !!recipe && !isUsableVessel(item, recipe);
				entry.canSetVessel = !!recipe && entry.left > 0 && !entry.blocked;
				entry.hasMix = !!getMix(recipe, item);
				context.vessels.push({ ...entry });
			}
			if (game.user.isGM && MATERIAL_TYPES.has(item.type) && !isUsableIngredient(table, item) && !isVessel(item)) {
				context.others.push(entry);
			}
		}
		const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
		context.ingredients.sort(byName);
		context.vessels.sort(byName);
		context.others.sort(byName);
		return context;
	}

	/** The research tab: the recipes the character can study, the selected project and its table. */
	#researchContext() {
		const list = listResearchable(this.actor).map(recipe => {
			const state = researchState(this.actor, recipe);
			return {
				id: recipe.id, name: recipe.name, img: recipe.img, counter: state.counter, needed: state.needed,
				started: state.started, selected: recipe.id === this.researchId
			};
		});
		const recipe = this.researchRecipe;
		let selected = null;
		if (recipe) {
			const state = researchState(this.actor, recipe);
			const tableState = evaluate(researchTable(recipe), this.actor, this.placed);
			const placedItems = [];
			for (const [itemId, units] of this.placed) {
				const item = this.actor.items.get(itemId);
				if (item && units > 0) {
					placedItems.push({ id: itemId, name: item.name, img: item.img, units });
				}
			}
			const canStart = state.started || !!state.sample;
			selected = {
				id: recipe.id, name: recipe.name, img: recipe.img,
				difficulty: state.difficulty, counter: state.counter, needed: state.needed,
				// The bar fills as the counter goes down.
				percent: Math.min(100, Math.round(((state.needed - state.counter) / state.needed) * 100)),
				started: state.started, sample: state.sample ? { name: state.sample.name, img: state.sample.img } : null,
				any: tableState.requirement.any, anyHave: tableState.anyHave, anyDone: tableState.anyHave >= tableState.requirement.any,
				count: tableState.count, total: tableState.requirement.total, placedItems,
				emptySlots: Array.from({ length: Math.max(0, tableState.requirement.total - tableState.count) }),
				canStart, ready: tableState.ready && canStart
			};
		}
		return { list, selected };
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		bindDragSources(this.element);
		bindDropZones(this.element, "[data-drop]", (items, zone, event) => this.#onDrop(items[0], zone.dataset.drop, event));
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		this._hooks = [
			["createItem", this.#onItemChange],
			["updateItem", this.#onItemChange],
			["deleteItem", this.#onItemChange],
			["updateActor", this.#onActorChange],
			[CHANGED_HOOK, this.#onBookChange]
		].map(([hook, fn]) => [hook, Hooks.on(hook, fn.bind(this))]);
	}

	_onClose(options) {
		super._onClose(options);
		for (const [hook, id] of this._hooks ?? []) {
			Hooks.off(hook, id);
		}
		this._hooks = null;
	}

	#onItemChange(item) {
		if (item.parent === this.actor && !this.busy) {
			this.render();
		}
	}

	#onActorChange(actor) {
		if (actor === this.actor && !this.busy) {
			this.render();
		}
	}

	#onBookChange() {
		this.render();
	}

	/** A drop on the ingredient table puts in one unit; a drop on the vessel slot (or a vessel anywhere) sets the vessel. */
	async #onDrop(item, target, event) {
		const recipe = this.table;
		if (!recipe || this.busy) {
			return;
		}
		if (item.parent !== this.actor) {
			ui.notifications.warn("MIST_ALCHEMY.Craft.NotOwnItem", { localize: true });
			return;
		}
		const asIngredient = target !== "vessel" && isUsableIngredient(recipe, item);
		if (asIngredient) {
			await this.#place(item, { all: event?.shiftKey });
			return;
		}
		if (this.tab === "brew" && isVessel(item)) {
			this.#setVessel(item);
			return;
		}
		if (game.user.isGM && await this.#askMark(item, target)) {
			return;
		}
		ui.notifications.warn(game.i18n.format(target === "vessel" ? "MIST_ALCHEMY.Craft.NotVessel" : "MIST_ALCHEMY.Craft.NotIngredient", { name: item.name }));
	}

	/** GM: an unmarked item was dropped; offer to mark it as an ingredient or a vessel, then put it in. */
	async #askMark(item, target) {
		const kind = await DialogV2.wait({
			window: { title: "MIST_ALCHEMY.Craft.MarkTitle" },
			content: `<p>${game.i18n.format("MIST_ALCHEMY.Craft.MarkQuestion", { name: foundry.utils.escapeHTML(item.name) })}</p>`,
			buttons: [
				{ action: "ingredients", label: "MIST_ALCHEMY.Craft.MarkIngredient", icon: "fa-solid fa-mortar-pestle", default: target !== "vessel" },
				{ action: "vessels", label: "MIST_ALCHEMY.Craft.MarkVessel", icon: "fa-solid fa-wine-bottle", default: target === "vessel" },
				{ action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
			],
			rejectClose: false
		});
		if (kind !== "ingredients" && kind !== "vessels") {
			return false;
		}
		await setMaterial(kind, item, true);
		if (kind === "ingredients") {
			await this.#place(item);
		} else {
			this.#setVessel(item);
		}
		return true;
	}

	#available(item) {
		return getQuantity(item) - (this.placed.get(item.id) ?? 0) - (item.id === this.vesselId ? 1 : 0);
	}

	/** How many more units of the item fit the recipe, limited by what is left of it. */
	#fits(item) {
		const recipe = this.table;
		const trial = new Map(this.placed);
		let count = 0;
		while (count < this.#available(item) && canPlace(recipe, this.actor, trial, item)) {
			trial.set(item.id, (trial.get(item.id) ?? 0) + 1);
			count += 1;
		}
		return count;
	}

	/** Asks how many units to put in, from 1 to max; resolves to the number or null when cancelled. */
	async #askCount(item, max) {
		const input = `<input type="number" name="count" value="${max}" min="1" max="${max}" step="1" autofocus>`;
		const label = game.i18n.format("MIST_ALCHEMY.Craft.HowMany", { name: foundry.utils.escapeHTML(item.name), max });
		const count = await DialogV2.prompt({
			window: { title: "MIST_ALCHEMY.Craft.HowManyTitle" },
			content: `<div class="mist-alchemy-count"><p>${label}</p>${input}</div>`,
			ok: {
				label: "MIST_ALCHEMY.Craft.Add",
				icon: "fa-solid fa-arrow-left",
				callback: (event, button) => Number(button.form.elements.count.value)
			},
			rejectClose: false
		});
		if (!Number.isFinite(count) || count < 1) {
			return null;
		}
		return Math.min(max, Math.floor(count));
	}

	/**
	 * Puts units of an ingredient in. When more than one fits, asks how many (all that fit by default);
	 * Shift skips the question and puts in all that fit.
	 */
	async #place(item, { all = false } = {}) {
		const max = this.#fits(item);
		if (max <= 0) {
			ui.notifications.warn(game.i18n.format("MIST_ALCHEMY.Craft.DoesNotFit", { name: item.name }));
			return;
		}
		const count = max === 1 || all ? max : await this.#askCount(item, max);
		// The dialog may have stayed open while the inventory or the table changed.
		const units = Math.min(count ?? 0, this.#fits(item));
		if (units <= 0) {
			return;
		}
		this.placed.set(item.id, (this.placed.get(item.id) ?? 0) + units);
		this.render();
	}

	#setVessel(item) {
		if (!isUsableVessel(item, this.recipe)) {
			ui.notifications.warn(game.i18n.format("MIST_ALCHEMY.Craft.AlcoholBlocked", { name: item.name, recipe: this.recipe?.name ?? "" }));
			return;
		}
		const previous = this.vesselId;
		this.vesselId = null;
		if (this.#available(item) <= 0) {
			this.vesselId = previous;
			ui.notifications.warn(game.i18n.format("MIST_ALCHEMY.Craft.NoneLeft", { name: item.name }));
			return;
		}
		this.vesselId = item.id;
		this.render();
	}

	static #itemFrom(target) {
		return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
	}

	static #onSelectRecipe(event, target) {
		const id = target.closest("[data-recipe-id]")?.dataset.recipeId;
		if (id && id !== this.recipeId && !this.busy) {
			this.recipeId = id;
			this.placed.clear();
			this.render();
		}
	}

	static async #onPlace(event, target) {
		const item = CraftWindow.#itemFrom.call(this, target);
		if (item && this.table && !this.busy) {
			await this.#place(item, { all: event.shiftKey });
		}
	}

	static #onUnplace(event, target) {
		const id = target.closest("[data-item-id]")?.dataset.itemId;
		if (!id || this.busy) {
			return;
		}
		const units = (this.placed.get(id) ?? 0) - 1;
		if (units > 0) {
			this.placed.set(id, units);
		} else {
			this.placed.delete(id);
		}
		this.render();
	}

	static #onSetVessel(event, target) {
		const item = CraftWindow.#itemFrom.call(this, target);
		if (item && this.recipe && !this.busy) {
			this.#setVessel(item);
		}
	}

	static #onClearVessel() {
		if (!this.busy) {
			this.vesselId = null;
			this.render();
		}
	}

	static #onClearAll() {
		if (!this.busy) {
			this.placed.clear();
			this.vesselId = null;
			this.render();
		}
	}

	static async #onToggleKnown(event, target) {
		event.stopPropagation();
		const id = target.closest("[data-recipe-id]")?.dataset.recipeId;
		if (!game.user.isGM || !id) {
			return;
		}
		await setRecipeKnown(this.actor, id, !getKnownRecipeIds(this.actor).includes(id));
	}

	static async #onMarkIngredient(event, target) {
		const item = CraftWindow.#itemFrom.call(this, target);
		if (game.user.isGM && item) {
			await setMaterial("ingredients", item, true);
		}
	}

	static async #onMarkVessel(event, target) {
		const item = CraftWindow.#itemFrom.call(this, target);
		if (game.user.isGM && item) {
			await setMaterial("vessels", item, true);
		}
	}

	static #onSwitchTab(event, target) {
		const tab = target.dataset.tab;
		if (!tab || tab === this.tab || this.busy) {
			return;
		}
		this.tab = tab;
		this.placed.clear();
		this.vesselId = null;
		this.render();
	}

	static #onSelectResearch(event, target) {
		const id = target.closest("[data-recipe-id]")?.dataset.recipeId;
		if (id && id !== this.researchId && !this.busy) {
			this.researchId = id;
			this.placed.clear();
			this.render();
		}
	}

	static async #onResearch() {
		const recipe = this.researchRecipe;
		if (!recipe || this.busy) {
			return;
		}
		this.busy = true;
		this.render();
		try {
			const outcome = await research(this.actor, recipe, this.placed);
			if (outcome) {
				this.placed.clear();
			}
		} catch (error) {
			console.error(`${MODULE_ID} | Research failed`, error);
			ui.notifications.error("MIST_ALCHEMY.Research.Failed", { localize: true });
		} finally {
			this.busy = false;
			this.render();
		}
	}

	static async #onBrew() {
		const recipe = this.recipe;
		if (!recipe || this.busy) {
			return;
		}
		this.busy = true;
		this.render();
		try {
			const outcome = await brew(this.actor, recipe, this.placed, this.vesselId);
			if (outcome) {
				this.placed.clear();
				this.vesselId = null;
			}
		} catch (error) {
			console.error(`${MODULE_ID} | Brewing failed`, error);
			ui.notifications.error("MIST_ALCHEMY.Craft.Failed", { localize: true });
		} finally {
			this.busy = false;
			this.render();
		}
	}
}

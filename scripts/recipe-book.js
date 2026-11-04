import {
	CHANGED_HOOK, HIDDEN_SLOTS, MODULE_ID, POTION_SLOTS, RARITIES, addMaterials, createRecipe, deleteRecipe, getDifficulty, getMaterials, getRecipe,
	addMix, getRequirement, listRecipes, normalizeName, removeMaterial, removeMix, setMixItem, setRecipeItem, setVesselAlcohol, updateRecipe
} from "./data.js";
import { bindDragSources, bindDropZones } from "./drag.js";
import { RESEARCH_PROGRESS } from "./data.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Re-renders an open window whenever the book or the materials change. Call from _onFirstRender. */
function followBook(app) {
	app._bookHook = Hooks.on(CHANGED_HOOK, () => {
		if (app.rendered) {
			app.render();
		}
	});
}

function unfollowBook(app) {
	if (app._bookHook) {
		Hooks.off(CHANGED_HOOK, app._bookHook);
		app._bookHook = null;
	}
}

function requirementText(recipe) {
	const { named, any } = getRequirement(recipe);
	const parts = named.map(entry => `${entry.name} ×${entry.quantity}`);
	if (any > 0) {
		parts.push(game.i18n.format("MIST_ALCHEMY.Book.AnyCount", { count: any }));
	}
	return parts.join(", ") || game.i18n.localize("MIST_ALCHEMY.Book.NoIngredients");
}

/** The GM's book of recipes and the list of which items are ingredients and which are vessels. */
export class RecipeBook extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-book`,
		classes: ["mist-alchemy", "mist-alchemy-book"],
		window: { title: "MIST_ALCHEMY.Book.Title", icon: "fa-solid fa-book-skull", resizable: true },
		position: { width: 620, height: 640 },
		actions: {
			switchTab: RecipeBook.#onTab,
			edit: RecipeBook.#onEdit,
			remove: RecipeBook.#onRemove,
			removeMaterial: RecipeBook.#onRemoveMaterial,
			toggleAlcohol: RecipeBook.#onToggleAlcohol
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/recipe-book.hbs` }
	};

	static #instance = null;

	static show() {
		if (!game.user.isGM) {
			return null;
		}
		RecipeBook.#instance ??= new RecipeBook();
		RecipeBook.#instance.render({ force: true });
		return RecipeBook.#instance;
	}

	constructor(options) {
		super(options);
		this.tab = "recipes";
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		followBook(this);
	}

	_onClose(options) {
		super._onClose(options);
		unfollowBook(this);
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const materials = getMaterials();
		context.tab = this.tab;
		context.recipes = listRecipes().map(recipe => ({
			...recipe,
			difficulty: getDifficulty(recipe),
			rarityLabel: game.i18n.localize(`MIST_ALCHEMY.Rarity.${recipe.rarity}`),
			requirement: requirementText(recipe),
			knownBy: game.actors
				.filter(actor => actor.type === "character" && (actor.getFlag(MODULE_ID, "recipes") ?? []).includes(recipe.id))
				.map(actor => actor.name)
				.join(", ")
		}));
		context.ingredients = materials.ingredients;
		context.vessels = materials.vessels;
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		bindDropZones(this.element, "[data-drop]", (items, zone) => this.#onDrop(items, zone.dataset.drop));
	}

	async #onDrop(items, target) {
		if (target === "recipe") {
			let id = null;
			for (const item of items) {
				id = await createRecipe(item);
			}
			if (items.length === 1) {
				RecipeEditor.show(id);
			}
			return;
		}
		const added = await addMaterials(target, items);
		ui.notifications.info(game.i18n.format("MIST_ALCHEMY.Book.Added", { count: added }));
	}

	static #onTab(event, target) {
		this.tab = target.dataset.tab;
		this.render();
	}

	static #onEdit(event, target) {
		RecipeEditor.show(target.closest("[data-recipe-id]").dataset.recipeId);
	}

	static async #onRemove(event, target) {
		const id = target.closest("[data-recipe-id]").dataset.recipeId;
		const recipe = getRecipe(id);
		const confirmed = await DialogV2.confirm({
			window: { title: "MIST_ALCHEMY.Book.RemoveTitle" },
			content: `<p>${game.i18n.format("MIST_ALCHEMY.Book.RemoveConfirm", { name: foundry.utils.escapeHTML(recipe?.name ?? "") })}</p>`
		});
		if (confirmed) {
			await deleteRecipe(id);
		}
	}

	static async #onToggleAlcohol(event, target) {
		const row = target.closest("[data-kind]");
		const index = Number(row.dataset.index);
		await setVesselAlcohol(index, !getMaterials().vessels[index]?.alcohol);
	}

	static async #onRemoveMaterial(event, target) {
		const row = target.closest("[data-kind]");
		await removeMaterial(row.dataset.kind, Number(row.dataset.index));
	}
}

/** One recipe: the potion, its enhanced version for a critical, difficulty and ingredients. Saves on every change. */
export class RecipeEditor extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-alchemy", "mist-alchemy-editor"],
		window: { icon: "fa-solid fa-scroll", resizable: true },
		position: { width: 760, height: "auto" },
		actions: {
			clearSlot: RecipeEditor.#onClearSlot,
			removeMix: RecipeEditor.#onRemoveMix,
			removeIngredient: RecipeEditor.#onRemoveIngredient
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/recipe-editor.hbs` }
	};

	static #instances = new Map();

	static show(recipeId) {
		if (!game.user.isGM || !getRecipe(recipeId)) {
			return null;
		}
		let app = RecipeEditor.#instances.get(recipeId);
		if (!app) {
			app = new RecipeEditor({ recipeId });
			RecipeEditor.#instances.set(recipeId, app);
		}
		app.render({ force: true });
		return app;
	}

	constructor(options) {
		super({ ...options, id: `${MODULE_ID}-recipe-${options.recipeId}` });
		this.recipeId = options.recipeId;
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		followBook(this);
	}

	_onClose(options) {
		super._onClose(options);
		unfollowBook(this);
	}

	get title() {
		return game.i18n.format("MIST_ALCHEMY.Editor.Title", { name: getRecipe(this.recipeId)?.name ?? "" });
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const recipe = getRecipe(this.recipeId);
		if (!recipe) {
			this.close();
			return context;
		}
		context.recipe = recipe;
		context.isCustom = recipe.rarity === "custom";
		context.difficulty = getDifficulty(recipe);
		context.rarities = Object.entries(RARITIES).map(([id, dc]) => ({
			id,
			label: game.i18n.localize(`MIST_ALCHEMY.Rarity.${id}`) + (dc ? ` (${dc})` : ""),
			selected: id === recipe.rarity
		}));
		context.total = getRequirement(recipe).total;
		context.research = {
			difficulty: recipe.researchDifficulty ?? "",
			progress: recipe.researchProgress ?? "",
			autoDifficulty: getDifficulty(recipe),
			autoProgress: RESEARCH_PROGRESS[recipe.rarity] ?? RESEARCH_PROGRESS.custom
		};
		const slot = id => ({
			id,
			item: recipe[id] ?? null,
			label: game.i18n.localize(`MIST_ALCHEMY.Editor.Slot.${id}.Label`),
			hint: game.i18n.localize(`MIST_ALCHEMY.Editor.Slot.${id}.Hint`),
			clearable: id !== "result",
			hidden: HIDDEN_SLOTS.has(id)
		});
		context.mainSlots = ["result", "enhanced"].map(slot);
		context.variantSlots = POTION_SLOTS.filter(id => HIDDEN_SLOTS.has(id)).map(slot);
		// A mix: the same five slots, read when this alcohol is the vessel. Empty slots give the recipe potion.
		context.mixes = Object.entries(recipe.mixes ?? {}).map(([mixId, mix]) => ({
			id: mixId,
			vessel: mix.vessel,
			img: mix.img,
			slots: POTION_SLOTS.map(id => ({
				...slot(id),
				id: `mix:${mixId}:${id}`,
				item: mix[id] ?? null,
				hint: game.i18n.localize(id === "result" ? "MIST_ALCHEMY.Editor.MixResultHint" : `MIST_ALCHEMY.Editor.Slot.${id}.Hint`),
				clearable: true,
				hidden: true
			}))
		}));
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		bindDragSources(this.element);
		bindDropZones(this.element, "[data-drop]", (items, zone) => this.#onDrop(items, zone.dataset.drop));
		const recipe = getRecipe(this.recipeId);
		this.element.querySelector("select[name=rarity]")?.addEventListener("change", event => {
			const rarity = event.target.value;
			const changes = { rarity };
			if (rarity === "custom") {
				changes.difficulty = getDifficulty(recipe);
			}
			updateRecipe(this.recipeId, changes);
		});
		this.element.querySelector("input[name=difficulty]")?.addEventListener("change", event => {
			updateRecipe(this.recipeId, { difficulty: Math.max(1, Number(event.target.value) || 1) });
		});
		this.element.querySelector("input[name=blockAlcohol]")?.addEventListener("change", event => {
			updateRecipe(this.recipeId, { blockAlcohol: event.target.checked });
		});
		for (const name of ["researchDifficulty", "researchProgress"]) {
			this.element.querySelector(`input[name=${name}]`)?.addEventListener("change", event => {
				const value = Math.floor(Number(event.target.value));
				updateRecipe(this.recipeId, { [name]: event.target.value === "" || !(value > 0) ? null : value });
			});
		}
		this.element.querySelector("input[name=anyIngredients]")?.addEventListener("change", event => {
			updateRecipe(this.recipeId, { anyIngredients: Math.max(0, Math.floor(Number(event.target.value) || 0)) });
		});
		for (const input of this.element.querySelectorAll("input[data-ingredient-index]")) {
			input.addEventListener("change", () => {
				const ingredients = [...(getRecipe(this.recipeId).ingredients ?? [])];
				const index = Number(input.dataset.ingredientIndex);
				ingredients[index] = { ...ingredients[index], quantity: Math.max(1, Math.floor(Number(input.value) || 1)) };
				updateRecipe(this.recipeId, { ingredients });
			});
		}
	}

	async #onDrop(items, target) {
		if (POTION_SLOTS.includes(target)) {
			await setRecipeItem(this.recipeId, target, items[0]);
			return;
		}
		if (target === "mix") {
			for (const item of items) {
				await addMix(this.recipeId, item);
			}
			return;
		}
		if (target.startsWith("mix:")) {
			const [, mixId, slot] = target.split(":");
			await setMixItem(this.recipeId, mixId, slot, items[0]);
			return;
		}
		if (target === "ingredient") {
			const ingredients = [...(getRecipe(this.recipeId).ingredients ?? [])];
			for (const item of items) {
				const key = normalizeName(item.name);
				const existing = ingredients.find(entry => normalizeName(entry.name) === key);
				if (existing) {
					existing.quantity += 1;
				} else {
					ingredients.push({ name: item.name, img: item.img, quantity: 1 });
				}
			}
			await updateRecipe(this.recipeId, { ingredients });
		}
	}

	static async #onClearSlot(event, target) {
		const slot = target.closest("[data-drop]")?.dataset.drop;
		if (slot?.startsWith("mix:")) {
			const [, mixId, mixSlot] = slot.split(":");
			await setMixItem(this.recipeId, mixId, mixSlot, null);
			return;
		}
		if (slot && slot !== "result") {
			await setRecipeItem(this.recipeId, slot, null);
		}
	}

	static async #onRemoveMix(event, target) {
		const mixId = target.closest("[data-mix-id]")?.dataset.mixId;
		if (mixId) {
			await removeMix(this.recipeId, mixId);
		}
	}

	static async #onRemoveIngredient(event, target) {
		const ingredients = [...(getRecipe(this.recipeId).ingredients ?? [])];
		ingredients.splice(Number(target.closest("[data-index]").dataset.index), 1);
		await updateRecipe(this.recipeId, { ingredients });
	}
}

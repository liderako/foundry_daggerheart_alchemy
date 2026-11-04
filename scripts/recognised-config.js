import { CHANGED_HOOK, MODULE_ID, POTION_SLOTS, getKnownRecipeIds, getRecognised, listOutcomeTables, setRecognised } from "./data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The GM's window of a character's recognised by-products: every recipe folded into one line with a count; open,
 * it is a table of its plain and alcohol rows against the three hidden outcomes, a checkbox per cell.
 */
export class RecognisedConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-alchemy", "mist-alchemy-recognised"],
		window: { icon: "fa-solid fa-eye", resizable: true },
		position: { width: 760, height: 600 },
		actions: {
			toggleRow: RecognisedConfig.#onToggleRow
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/recognised.hbs` }
	};

	static #instances = new Map();

	static show(actor) {
		if (!game.user.isGM || !actor) {
			return null;
		}
		let app = RecognisedConfig.#instances.get(actor.uuid);
		if (!app) {
			app = new RecognisedConfig(actor);
			RecognisedConfig.#instances.set(actor.uuid, app);
		}
		app.render({ force: true });
		return app;
	}

	/** How many combinations the character recognises, of how many there are. */
	static count(actor) {
		const known = new Set(getRecognised(actor));
		let total = 0;
		let have = 0;
		for (const table of listOutcomeTables()) {
			for (const row of table.rows) {
				for (const cell of row.cells) {
					if (cell) {
						total += 1;
						have += known.has(cell.key) ? 1 : 0;
					}
				}
			}
		}
		return { have, total };
	}

	constructor(actor, options = {}) {
		super({ ...options, id: `${MODULE_ID}-recognised-${actor.id}` });
		this.actor = actor;
		/** Recipes unfolded by the GM, kept across renders. */
		this.open = new Set();
		this.filter = "";
	}

	get title() {
		return game.i18n.format("MIST_ALCHEMY.Recognised.Title", { actor: this.actor.name });
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const known = new Set(getRecognised(this.actor));
		const knownRecipes = new Set(getKnownRecipeIds(this.actor));
		const filter = this.filter.trim().toLocaleLowerCase();
		context.filter = this.filter;
		context.columns = POTION_SLOTS.map(slot => game.i18n.localize(`MIST_ALCHEMY.Editor.Slot.${slot}.Label`));
		context.recipes = listOutcomeTables()
			.filter(table => !filter || table.name.toLocaleLowerCase().includes(filter))
			.map(table => {
				const rows = table.rows.map(row => ({
					...row,
					label: row.plain ? game.i18n.localize("MIST_ALCHEMY.Recognised.Plain") : row.label,
					cells: row.cells.map(cell => (cell ? { ...cell, known: known.has(cell.key) } : null))
				}));
				const have = rows.reduce((sum, row) => sum + row.cells.filter(cell => cell?.known).length, 0);
				return { ...table, rows, have, open: this.open.has(table.id), learnt: knownRecipes.has(table.id) };
			})
			// Recipes the character knows first, then by name.
			.sort((a, b) => (b.learnt - a.learnt) || a.name.localeCompare(b.name, game.i18n.lang));
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		// Typing filters after a short pause; the re-render keeps the cursor in the search box.
		const search = this.element.querySelector("input[name=filter]");
		if (search && this._refocus) {
			search.focus();
			search.setSelectionRange(search.value.length, search.value.length);
			this._refocus = false;
		}
		search?.addEventListener("input", foundry.utils.debounce(() => {
			this.filter = search.value;
			this._refocus = true;
			this.render();
		}, 250));
		for (const details of this.element.querySelectorAll("details[data-recipe-id]")) {
			details.addEventListener("toggle", () => {
				if (details.open) {
					this.open.add(details.dataset.recipeId);
				} else {
					this.open.delete(details.dataset.recipeId);
				}
			});
		}
		for (const input of this.element.querySelectorAll("input[data-outcome-key]")) {
			input.addEventListener("change", () => setRecognised(this.actor, input.dataset.outcomeKey, input.checked));
		}
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		this._hooks = [
			[CHANGED_HOOK, Hooks.on(CHANGED_HOOK, () => this.render())],
			["updateActor", Hooks.on("updateActor", actor => {
				if (actor === this.actor) {
					this.render();
				}
			})]
		];
	}

	_onClose(options) {
		super._onClose(options);
		for (const [hook, id] of this._hooks ?? []) {
			Hooks.off(hook, id);
		}
		this._hooks = null;
	}

	/** Ticks or unticks every cell of one row (the plain recipe or one alcohol) at once. */
	static async #onToggleRow(event, target) {
		const keys = [...target.closest("tr").querySelectorAll("input[data-outcome-key]")].map(input => input.dataset.outcomeKey);
		if (!keys.length) {
			return;
		}
		const known = new Set(getRecognised(this.actor));
		const on = !keys.every(key => known.has(key));
		for (const key of keys) {
			if (on) {
				known.add(key);
			} else {
				known.delete(key);
			}
		}
		await this.actor.setFlag(MODULE_ID, "recognised", [...known]);
	}
}


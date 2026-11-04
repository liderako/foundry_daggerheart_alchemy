import {
	CHANGED_HOOK, MODULE_ID, canCraft, getDifficulty, getKnownRecipeIds, getProjects, getResearchProgress, listRecipes,
	projectCounter, removeProject, setCraftEnabled, setProjectCounter, setRecipeKnown
} from "./data.js";
import { CraftWindow } from "./craft-window.js";
import { RecipeBook } from "./recipe-book.js";
import { RecognisedConfig } from "./recognised-config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The GM's settings of one character: whether they can brew at all and which recipes they know. */
export class ActorConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-alchemy", "mist-alchemy-actor"],
		window: { icon: "fa-solid fa-flask", resizable: true },
		position: { width: 420, height: "auto" },
		actions: {
			openBook: () => RecipeBook.show(),
			openCraft: ActorConfig.#onOpenCraft,
			openRecognised: ActorConfig.#onOpenRecognised
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/actor-config.hbs` }
	};

	static #instances = new Map();

	static show(actor) {
		if (!game.user.isGM || !actor) {
			return null;
		}
		let app = ActorConfig.#instances.get(actor.uuid);
		if (!app) {
			app = new ActorConfig(actor);
			ActorConfig.#instances.set(actor.uuid, app);
		}
		app.render({ force: true });
		return app;
	}

	constructor(actor, options = {}) {
		super({ ...options, id: `${MODULE_ID}-actor-${actor.id}` });
		this.actor = actor;
	}

	get title() {
		return game.i18n.format("MIST_ALCHEMY.Actor.Title", { actor: this.actor.name });
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const known = new Set(getKnownRecipeIds(this.actor));
		context.enabled = canCraft(this.actor);
		context.recipes = listRecipes().map(recipe => ({
			id: recipe.id,
			name: recipe.name,
			img: recipe.img,
			difficulty: getDifficulty(recipe),
			known: known.has(recipe.id)
		}));
		context.recognised = RecognisedConfig.count(this.actor);
		const projects = getProjects(this.actor);
		const book = Object.fromEntries(listRecipes().map(recipe => [recipe.id, recipe]));
		context.projects = Object.entries(projects)
			.filter(([id]) => book[id])
			.map(([id, project]) => {
				const needed = getResearchProgress(book[id]);
				return { id, name: book[id].name, img: book[id].img, counter: projectCounter(project, needed), needed };
			});
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		this.element.querySelector("input[name=enabled]")?.addEventListener("change", event => {
			setCraftEnabled(this.actor, event.target.checked);
		});
		for (const input of this.element.querySelectorAll("input[data-recipe-id]")) {
			input.addEventListener("change", () => setRecipeKnown(this.actor, input.dataset.recipeId, input.checked));
		}
		for (const input of this.element.querySelectorAll("input[data-project-id]")) {
			input.addEventListener("change", () => setProjectCounter(this.actor, input.dataset.projectId, input.value));
		}
		for (const button of this.element.querySelectorAll("a[data-remove-project]")) {
			button.addEventListener("click", () => removeProject(this.actor, button.dataset.removeProject));
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

	static #onOpenRecognised() {
		RecognisedConfig.show(this.actor);
	}

	static #onOpenCraft() {
		CraftWindow.show(this.actor);
	}
}

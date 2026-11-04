import { CHANGED_HOOK, MODULE_ID, canCraft, getKnownRecipeIds, getProjects, listRecipes, setCraftEnabled } from "./data.js";
import { ActorConfig } from "./actor-config.js";
import { CraftWindow } from "./craft-window.js";
import { RecipeBook } from "./recipe-book.js";
import { RecognisedConfig } from "./recognised-config.js";

/** The Mist Age - Learn Projects, when it is active: its column and button in the panel. */
function learnApi() {
	const module = game.modules.get("mist-age-learn-projects");
	return module?.active ? module.api ?? null : null;
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The GM's alchemy panel: every player character in one list, with brewing on or off, what they know, and buttons
 * to their alchemy settings, alchemy window and recognised results, without opening their sheets.
 */
export class AlchemyHub extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-hub`,
		classes: ["mist-alchemy", "mist-alchemy-hub"],
		window: { title: "MIST_ALCHEMY.Hub.Title", icon: "fa-solid fa-flask", resizable: true },
		position: { width: 620, height: "auto" },
		actions: {
			openBook: () => RecipeBook.show(),
			openSettings: AlchemyHub.#onOpenSettings,
			openCraft: AlchemyHub.#onOpenCraft,
			openRecognised: AlchemyHub.#onOpenRecognised,
			openLearn: AlchemyHub.#onOpenLearn
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/hub.hbs` }
	};

	static #instance = null;

	static show() {
		if (!game.user.isGM) {
			return null;
		}
		AlchemyHub.#instance ??= new AlchemyHub();
		AlchemyHub.#instance.render({ force: true });
		return AlchemyHub.#instance;
	}

	/** Player characters, and any other character with brewing turned on. */
	static #characters() {
		return game.actors
			.filter(actor => actor.type === "character" && (actor.hasPlayerOwner || canCraft(actor)))
			.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const book = new Set(listRecipes().map(recipe => recipe.id));
		context.total = book.size;
		context.learn = !!learnApi();
		context.characters = AlchemyHub.#characters().map(actor => {
			const recognised = RecognisedConfig.count(actor);
			return {
				id: actor.id,
				name: actor.name,
				img: actor.img,
				enabled: canCraft(actor),
				known: getKnownRecipeIds(actor).filter(id => book.has(id)).length,
				projects: Object.keys(getProjects(actor)).filter(id => book.has(id)).length,
				recognised: recognised.have,
				learn: learnApi()?.count(actor).active ?? 0
			};
		});
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		for (const input of this.element.querySelectorAll("input[data-enable]")) {
			input.addEventListener("change", () => {
				const actor = game.actors.get(input.dataset.enable);
				if (actor) {
					setCraftEnabled(actor, input.checked);
				}
			});
		}
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		const refresh = () => {
			if (this.rendered) {
				this.render();
			}
		};
		this._hooks = [
			[CHANGED_HOOK, Hooks.on(CHANGED_HOOK, refresh)],
			["updateActor", Hooks.on("updateActor", actor => {
				if (actor.type === "character") {
					refresh();
				}
			})],
			["createActor", Hooks.on("createActor", refresh)],
			["deleteActor", Hooks.on("deleteActor", refresh)]
		];
	}

	_onClose(options) {
		super._onClose(options);
		for (const [hook, id] of this._hooks ?? []) {
			Hooks.off(hook, id);
		}
		this._hooks = null;
	}

	static #actorFrom(target) {
		return game.actors.get(target.closest("[data-actor-id]")?.dataset.actorId);
	}

	static #onOpenSettings(event, target) {
		ActorConfig.show(AlchemyHub.#actorFrom(target));
	}

	static #onOpenCraft(event, target) {
		CraftWindow.show(AlchemyHub.#actorFrom(target));
	}

	static #onOpenLearn(event, target) {
		learnApi()?.show(AlchemyHub.#actorFrom(target));
	}

	static #onOpenRecognised(event, target) {
		RecognisedConfig.show(AlchemyHub.#actorFrom(target));
	}
}

import { HIDDEN_SLOTS, MODULE_ID, POTION_SLOTS, comboKey, getRecipes, getRecognised, normalizeName } from "./data.js";

// A character who drinks a hidden brew without knowing what it is learns that potion: every combination (recipe,
// alcohol or none, outcome) that gives it becomes one of their recognised results, as if the GM had ticked them, so it
// comes out identified from then on, whatever it is brewed from. The Equipment module identifies the potion as it is
// drunk, and says so in the update's options.
import { partyAlchemists } from "./party-config.js";

const EQUIPMENT_ID = "mist-age-equipment";
// The flag a hidden brew keeps: the key of the combination it came from.
export const COMBO_FLAG = "combo";

/**
 * Every hidden combination, in every recipe, plain or on any alcohol, that gives the potion with this name: knowing what
 * a potion does, the character knows it wherever it comes out.
 */
export function combosOfPotion(potionName) {
	const name = normalizeName(potionName);
	return combosOfAll().filter(combo => combo.name === name).map(combo => combo.key);
}

/** Adds combinations to a character's recognised results. Returns whether anything was new. */
async function learn(actor, keys) {
	const known = new Set(getRecognised(actor));
	const fresh = keys.filter(key => !known.has(key));
	if (fresh.length) {
		await actor.setFlag(MODULE_ID, "recognised", [...known, ...fresh]);
	}
	return fresh.length > 0;
}

/**
 * A potion identified by being drunk. The drinker's own client teaches the drinker (it owns them); the active GM's
 * client teaches the alchemy party's alchemists (set in the module settings), whose characters belong to other players.
 */
async function onUpdateItem(item, changes, options, userId) {
	if (options?.[EQUIPMENT_ID]?.identifiedBy !== "use") {
		return;
	}
	const actor = item.actor;
	if (!actor || actor.type !== "character") {
		return;
	}
	const mine = userId === game.user.id;
	const gm = game.user.isActiveGM;
	if (!mine && !gm) {
		return;
	}
	const own = item.getFlag(MODULE_ID, COMBO_FLAG);
	const keys = [...new Set([...(own ? [own] : []), ...combosOfPotion(item._source?.name ?? item.name)])];
	if (!keys.length) {
		return;
	}
	const format = (key, data) => game.i18n.format(`MIST_ALCHEMY.Chat.${key}`, data);
	if (mine && await learn(actor, keys)) {
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			content: `<p>${format("LearntByDrinking", { actor: actor.name, name: item.name })}</p>`
		});
	}
	if (!gm) {
		return;
	}
	const taught = [];
	for (const alchemist of partyAlchemists(actor)) {
		if (await learn(alchemist, keys)) {
			taught.push(alchemist.name);
		}
	}
	if (taught.length) {
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			content: `<p>${format("LearntFromParty", { actors: taught.join(", "), actor: actor.name, name: item.name })}</p>`
		});
	}
}

// Which version of the known-potions rule the world's characters are on: 1 knows a potion everywhere it comes out.
const MIGRATION = "learnByPotion";

/** The combinations to add to a character's recognised results so every potion they know is known everywhere. */
export function widenRecognised(recognised) {
	const known = new Set(recognised);
	const names = new Map(combosOfAll().map(combo => [combo.key, combo.name]));
	const potions = new Set(recognised.map(key => names.get(key)).filter(Boolean));
	return [...names].filter(([key, name]) => potions.has(name) && !known.has(key)).map(([key]) => key);
}

/** Every hidden combination with the name of its potion. */
function combosOfAll() {
	const named = ref => normalizeName(ref?.name ?? ref?.data?.name);
	const all = [];
	for (const [recipeId, recipe] of Object.entries(getRecipes())) {
		const tables = [[null, recipe], ...Object.entries(recipe.mixes ?? {})];
		for (const [mixId, table] of tables) {
			for (const slot of POTION_SLOTS) {
				// Without alcohol only the by-products are hidden; on alcohol every outcome is.
				if ((mixId || HIDDEN_SLOTS.has(slot)) && table[slot]?.data) {
					all.push({ key: comboKey(recipeId, mixId, slot), name: named(table[slot]) });
				}
			}
		}
	}
	return all;
}

/**
 * Once per world, by the GM: characters who already knew a hidden potion in one recipe, from before drinking taught a
 * potion everywhere, get it in every recipe it comes out of.
 */
async function migrate() {
	if (!game.user.isActiveGM || game.settings.get(MODULE_ID, MIGRATION) >= 1) {
		return;
	}
	for (const actor of game.actors.filter(actor => actor.type === "character")) {
		const recognised = getRecognised(actor);
		const extra = widenRecognised(recognised);
		if (extra.length) {
			await actor.setFlag(MODULE_ID, "recognised", [...recognised, ...extra]);
		}
	}
	await game.settings.set(MODULE_ID, MIGRATION, 1);
}

/** Called during init. */
export function registerLearnByDrinking() {
	game.settings.register(MODULE_ID, MIGRATION, { scope: "world", config: false, type: Number, default: 0 });
	Hooks.on("updateItem", onUpdateItem);
	Hooks.once("ready", migrate);
}

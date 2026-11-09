import { HIDDEN_SLOTS, MODULE_ID, POTION_SLOTS, comboKey, getRecipes, getRecognised, normalizeName } from "./data.js";

// A character who drinks a hidden brew without knowing what it is learns it: the combination it came from (recipe,
// alcohol or none, outcome) becomes one of their recognised results, as if the GM had ticked it, so the next brew of it
// comes out identified. The Equipment module identifies the potion as it is drunk, and says so in the update's options.
const EQUIPMENT_ID = "mist-age-equipment";
// The flag a hidden brew keeps: the key of the combination it came from.
export const COMBO_FLAG = "combo";

/**
 * The combinations an older hidden brew, made before brews kept their combination, may have come from: recipes whose
 * potion it went by, and their hidden slots holding a potion of its real name.
 */
function guessCombos(item, shownName) {
	const real = normalizeName(item._source?.name ?? item.name);
	const shown = normalizeName(shownName);
	const named = ref => normalizeName(ref?.name ?? ref?.data?.name);
	const keys = [];
	for (const [recipeId, recipe] of Object.entries(getRecipes())) {
		if (named(recipe.result) !== shown) {
			continue;
		}
		const tables = [[null, recipe], ...Object.entries(recipe.mixes ?? {})];
		for (const [mixId, table] of tables) {
			for (const slot of POTION_SLOTS) {
				// Without alcohol only the by-products are hidden; on alcohol every outcome is.
				if ((mixId || HIDDEN_SLOTS.has(slot)) && table[slot]?.data && named(table[slot]) === real) {
					keys.push(comboKey(recipeId, mixId, slot));
				}
			}
		}
	}
	return keys;
}

async function onUpdateItem(item, changes, options, userId) {
	if (userId !== game.user.id || options?.[EQUIPMENT_ID]?.identifiedBy !== "use") {
		return;
	}
	const actor = item.actor;
	if (!actor || actor.type !== "character") {
		return;
	}
	const own = item.getFlag(MODULE_ID, COMBO_FLAG);
	const keys = own ? [own] : guessCombos(item, item.getFlag(EQUIPMENT_ID, "mystery")?.name);
	const known = new Set(getRecognised(actor));
	const fresh = keys.filter(key => !known.has(key));
	if (!fresh.length) {
		return;
	}
	await actor.setFlag(MODULE_ID, "recognised", [...known, ...fresh]);
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `<p>${game.i18n.format("MIST_ALCHEMY.Chat.LearntByDrinking", { actor: actor.name, name: item.name })}</p>`
	});
}

export function registerLearnByDrinking() {
	Hooks.on("updateItem", onUpdateItem);
}

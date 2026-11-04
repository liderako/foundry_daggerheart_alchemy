export const MODULE_ID = "mist-age-alchemy";

const RECIPES = "recipes";
const MATERIALS = "materials";
const TRAIT = "trait";

/** Craft difficulty by potion rarity (the Mist Age alchemy rules). "custom" keeps the recipe's own number. */
export const RARITIES = {
	common: 12,
	uncommon: 14,
	rare: 16,
	legendary: 18,
	custom: null
};

/** Research: the counter a recipe starts at, by rarity ("custom" rarity uses uncommon's); it counts down to 0. */
export const RESEARCH_PROGRESS = {
	common: 6,
	uncommon: 8,
	rare: 14,
	legendary: 16,
	custom: 8
};

/** Research: alchemy ingredients of any kind spent on every attempt. */
export const RESEARCH_INGREDIENTS = 3;

/** Research: how much each outcome of the Knowledge roll takes off the counter (negative puts some back). */
export const RESEARCH_GAIN = {
	critical: 3,
	successHope: 2,
	successFear: 1,
	failureHope: 0,
	failureFear: -1
};

/** A new recipe needs this many alchemy ingredients of any kind. */
export const DEFAULT_ANY_INGREDIENTS = 3;

/**
 * The potion slots of a recipe. "result" is the potion by the recipe (success with Hope, and every outcome without
 * a potion of its own), "enhanced" the one on a critical. The other three are variants given hidden: unidentified,
 * going by the recipe potion's name and picture until the GM identifies them.
 */
export const POTION_SLOTS = ["result", "enhanced", "successFear", "failureHope", "failureFear"];
export const HIDDEN_SLOTS = new Set(["successFear", "failureHope", "failureFear"]);

export const CHANGED_HOOK = `${MODULE_ID}.changed`;

function notifyChanged() {
	Hooks.callAll(CHANGED_HOOK);
}

export function registerSettings() {
	// The recipe book: { [id]: Recipe }. See newRecipe for the fields.
	game.settings.register(MODULE_ID, RECIPES, {
		scope: "world",
		config: false,
		type: Object,
		default: {},
		onChange: notifyChanged
	});

	// Which items count as alchemy ingredients and which as vessels, matched by name: { ingredients: [], vessels: [] }.
	game.settings.register(MODULE_ID, MATERIALS, {
		scope: "world",
		config: false,
		type: Object,
		default: { ingredients: [], vessels: [] },
		onChange: notifyChanged
	});

	game.settings.register(MODULE_ID, TRAIT, {
		name: "MIST_ALCHEMY.Settings.Trait.Name",
		hint: "MIST_ALCHEMY.Settings.Trait.Hint",
		scope: "world",
		config: true,
		type: String,
		default: "knowledge",
		choices: {
			agility: "DAGGERHEART.CONFIG.Traits.agility.name",
			strength: "DAGGERHEART.CONFIG.Traits.strength.name",
			finesse: "DAGGERHEART.CONFIG.Traits.finesse.name",
			instinct: "DAGGERHEART.CONFIG.Traits.instinct.name",
			presence: "DAGGERHEART.CONFIG.Traits.presence.name",
			knowledge: "DAGGERHEART.CONFIG.Traits.knowledge.name"
		}
	});
}

export function getTrait() {
	return game.settings.get(MODULE_ID, TRAIT) || "knowledge";
}

/* -------------------------------------------- */
/*  Names                                       */
/* -------------------------------------------- */

/** Items are matched by name, so copies already on characters count without any marking. */
export function normalizeName(name) {
	return String(name ?? "").trim().toLocaleLowerCase();
}

/* -------------------------------------------- */
/*  Recipes                                     */
/* -------------------------------------------- */

export function getRecipes() {
	return foundry.utils.deepClone(game.settings.get(MODULE_ID, RECIPES) ?? {});
}

export function getRecipe(id) {
	return getRecipes()[id] ?? null;
}

/** The recipes as a list sorted by name. */
export function listRecipes() {
	return Object.entries(getRecipes())
		.map(([id, recipe]) => ({ ...recipe, id }))
		.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

export function getDifficulty(recipe) {
	return RARITIES[recipe.rarity] ?? (Number(recipe.difficulty) || RARITIES.common);
}

/** The ingredients a recipe asks for: the named ones and the count of any alchemy ingredients. */
export function getRequirement(recipe) {
	const named = (recipe.ingredients ?? []).filter(entry => entry.quantity > 0);
	const any = Math.max(0, Number(recipe.anyIngredients) || 0);
	const total = named.reduce((sum, entry) => sum + entry.quantity, 0) + any;
	return { named, any, total };
}

/** The data of an item kept in a recipe, so players can get the potion without access to the world item. */
export function snapshotItem(item) {
	const data = item.toObject();
	for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) {
		delete data[key];
	}
	return data;
}

function itemRef(item) {
	return { uuid: item.uuid, name: item.name, img: item.img, data: snapshotItem(item) };
}

export function newRecipe(item) {
	return {
		name: item.name,
		img: item.img,
		result: itemRef(item),
		enhanced: null,
		successFear: null,
		failureHope: null,
		failureFear: null,
		rarity: "common",
		difficulty: RARITIES.common,
		ingredients: [],
		anyIngredients: DEFAULT_ANY_INGREDIENTS,
		mixes: {},
		blockAlcohol: false
	};
}

async function saveRecipes(recipes) {
	await game.settings.set(MODULE_ID, RECIPES, recipes);
}

/** Adds a recipe for the dropped potion and returns its id. */
export async function createRecipe(item) {
	const recipes = getRecipes();
	const id = foundry.utils.randomID();
	recipes[id] = newRecipe(item);
	await saveRecipes(recipes);
	return id;
}

export async function updateRecipe(id, changes) {
	const recipes = getRecipes();
	if (!recipes[id]) {
		return;
	}
	recipes[id] = { ...recipes[id], ...changes };
	await saveRecipes(recipes);
}

export async function setRecipeItem(id, slot, item) {
	const changes = { [slot]: item ? itemRef(item) : null };
	if (slot === "result" && item) {
		changes.name = item.name;
		changes.img = item.img;
	}
	await updateRecipe(id, changes);
}

/* -------------------------------------------- */
/*  Mixes: a vessel (a bottle of alcohol) with   */
/*  its own outcome table for a recipe           */
/* -------------------------------------------- */

/**
 * The mix of a recipe for a vessel, matched by the vessel's name, or null. A mix is
 * { vessel, img, result, enhanced, successFear, failureHope, failureFear }, the slots like the recipe's own.
 */
export function getMix(recipe, vessel) {
	if (!recipe || !vessel) {
		return null;
	}
	const key = normalizeName(vessel.name);
	const entry = Object.entries(recipe.mixes ?? {}).find(([, mix]) => normalizeName(mix.vessel) === key);
	return entry ? { ...entry[1], id: entry[0] } : null;
}

/** Adds a mix for the dropped vessel (and marks it as a vessel); returns the mix id, or the existing one. */
export async function addMix(recipeId, vessel) {
	const recipe = getRecipe(recipeId);
	if (!recipe) {
		return null;
	}
	const mixes = { ...(recipe.mixes ?? {}) };
	const key = normalizeName(vessel.name);
	const existing = Object.entries(mixes).find(([, mix]) => normalizeName(mix.vessel) === key);
	if (existing) {
		return existing[0];
	}
	const id = foundry.utils.randomID();
	mixes[id] = { vessel: vessel.name, img: vessel.img, ...Object.fromEntries(POTION_SLOTS.map(slot => [slot, null])) };
	await updateRecipe(recipeId, { mixes });
	await addMaterial("vessels", vessel);
	const index = getMaterials().vessels.findIndex(entry => normalizeName(entry.name) === key);
	if (index >= 0 && !getMaterials().vessels[index].alcohol) {
		await setVesselAlcohol(index, true);
	}
	return id;
}

export async function removeMix(recipeId, mixId) {
	const recipe = getRecipe(recipeId);
	if (!recipe?.mixes?.[mixId]) {
		return;
	}
	const mixes = { ...recipe.mixes };
	delete mixes[mixId];
	await updateRecipe(recipeId, { mixes });
}

export async function setMixItem(recipeId, mixId, slot, item) {
	const recipe = getRecipe(recipeId);
	if (!recipe?.mixes?.[mixId] || !POTION_SLOTS.includes(slot)) {
		return;
	}
	const mixes = foundry.utils.deepClone(recipe.mixes);
	mixes[mixId][slot] = item ? itemRef(item) : null;
	await updateRecipe(recipeId, { mixes });
}

export async function deleteRecipe(id) {
	const recipes = getRecipes();
	delete recipes[id];
	await saveRecipes(recipes);
}

/** Keeps the saved potions up to date with the world items they came from. Runs for the GM on load. */
export async function refreshSnapshots() {
	if (!game.user.isGM) {
		return;
	}
	const recipes = getRecipes();
	let changed = false;
	const refresh = async (holder, slot) => {
		const ref = holder[slot];
		if (!ref?.uuid) {
			return null;
		}
		const item = await fromUuid(ref.uuid).catch(() => null);
		if (!item) {
			return null;
		}
		const fresh = itemRef(item);
		if (JSON.stringify(fresh) === JSON.stringify(ref)) {
			return null;
		}
		holder[slot] = fresh;
		changed = true;
		return item;
	};
	for (const recipe of Object.values(recipes)) {
		for (const slot of POTION_SLOTS) {
			const item = await refresh(recipe, slot);
			if (item && slot === "result") {
				recipe.name = item.name;
				recipe.img = item.img;
			}
			for (const mix of Object.values(recipe.mixes ?? {})) {
				await refresh(mix, slot);
			}
		}
	}
	if (changed) {
		await saveRecipes(recipes);
	}
}

/* -------------------------------------------- */
/*  Materials                                   */
/* -------------------------------------------- */

export function getMaterials() {
	const saved = game.settings.get(MODULE_ID, MATERIALS) ?? {};
	return {
		ingredients: [...(saved.ingredients ?? [])],
		vessels: [...(saved.vessels ?? [])]
	};
}

/** Adds items (by name) to the ingredients ("ingredients") or the vessels ("vessels"); returns how many were new. */
export async function addMaterials(kind, items) {
	const materials = getMaterials();
	let added = 0;
	for (const item of items) {
		const key = normalizeName(item.name);
		if (!key || materials[kind].some(entry => normalizeName(entry.name) === key)) {
			continue;
		}
		materials[kind].push({ name: item.name, img: item.img });
		added += 1;
	}
	if (added) {
		materials[kind].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
		await game.settings.set(MODULE_ID, MATERIALS, materials);
	}
	return added;
}

export function addMaterial(kind, item) {
	return addMaterials(kind, [item]);
}

/** Adds or removes an item (by name) from the ingredients ("ingredients") or the vessels ("vessels"). */
export async function setMaterial(kind, item, on) {
	if (on) {
		await addMaterial(kind, item);
		return;
	}
	const materials = getMaterials();
	const key = normalizeName(item.name);
	materials[kind] = materials[kind].filter(entry => normalizeName(entry.name) !== key);
	await game.settings.set(MODULE_ID, MATERIALS, materials);
}

export async function removeMaterial(kind, index) {
	const materials = getMaterials();
	materials[kind].splice(index, 1);
	await game.settings.set(MODULE_ID, MATERIALS, materials);
}

export function isIngredient(item) {
	const key = normalizeName(item.name);
	return getMaterials().ingredients.some(entry => normalizeName(entry.name) === key);
}

export function isVessel(item) {
	const key = normalizeName(item.name);
	return getMaterials().vessels.some(entry => normalizeName(entry.name) === key);
}

/** A vessel marked as alcohol in the materials (a bottle of wine, beer, swill), as opposed to a plain vial. */
export function isAlcohol(item) {
	const key = normalizeName(item?.name);
	return getMaterials().vessels.some(entry => entry.alcohol && normalizeName(entry.name) === key);
}

/** Marks or unmarks a vessel (by its index in the vessel list) as alcohol. */
export async function setVesselAlcohol(index, alcohol) {
	const materials = getMaterials();
	if (!materials.vessels[index]) {
		return;
	}
	materials.vessels[index] = { ...materials.vessels[index], alcohol: !!alcohol };
	await game.settings.set(MODULE_ID, MATERIALS, materials);
}

/** A vessel this recipe accepts: any vessel, except alcohol when the recipe forbids mixing with it. */
export function vesselAllowed(recipe, item) {
	return isVessel(item) && !(recipe?.blockAlcohol && isAlcohol(item));
}

/* -------------------------------------------- */
/*  Characters                                  */
/* -------------------------------------------- */

export function canCraft(actor) {
	return actor?.type === "character" && !!actor.getFlag(MODULE_ID, "enabled");
}

export function getKnownRecipeIds(actor) {
	return [...(actor?.getFlag(MODULE_ID, "recipes") ?? [])];
}

/** The recipes the character knows, skipping ones the GM has since removed from the book. */
export function getKnownRecipes(actor) {
	const known = new Set(getKnownRecipeIds(actor));
	return listRecipes().filter(recipe => known.has(recipe.id));
}

export async function setCraftEnabled(actor, enabled) {
	await actor.setFlag(MODULE_ID, "enabled", !!enabled);
}

export async function setRecipeKnown(actor, recipeId, known) {
	const ids = new Set(getKnownRecipeIds(actor));
	if (known) {
		ids.add(recipeId);
	} else {
		ids.delete(recipeId);
	}
	await actor.setFlag(MODULE_ID, "recipes", [...ids]);
}

/* -------------------------------------------- */
/*  Recognised results: potions a character     */
/*  knows by sight without being able to brew   */
/* -------------------------------------------- */

/** The key a potion ref is remembered by: its source uuid, else its name. */
export function potionKey(ref) {
	return ref?.uuid || `name:${normalizeName(ref?.name ?? ref?.data?.name)}`;
}

/** The key of one known combination: recipe, alcohol table (or the plain recipe) and outcome slot. */
export function comboKey(recipeId, mixId, slot) {
	return `combo:${recipeId}:${mixId ?? "base"}:${slot}`;
}

/**
 * The hidden outcomes of every recipe as a table: a row for the plain recipe and one per alcohol, a cell per slot
 * in POTION_SLOTS order (null when the slot is empty or never hidden: the plain recipe's potion and its critical).
 * Recipes without any hidden outcome are left out.
 * [{ id, name, img, total, rows: [{ label, img, plain, cells: [{ key, slot, name, img } | null] }] }]
 */
export function listOutcomeTables() {
	const i18n = game.i18n;
	// Without alcohol only the by-products are hidden; on alcohol every outcome is.
	const cells = (recipeId, mixId, table) => POTION_SLOTS.map(slot => ((mixId || HIDDEN_SLOTS.has(slot)) && table[slot]?.data ? {
		key: comboKey(recipeId, mixId, slot),
		slot,
		name: table[slot].name ?? table[slot].data.name,
		img: table[slot].img ?? table[slot].data.img
	} : null));
	const tables = [];
	for (const recipe of listRecipes()) {
		const rows = [{ label: null, img: recipe.img, plain: true, cells: cells(recipe.id, null, recipe) }];
		const mixes = Object.entries(recipe.mixes ?? {}).sort(([, a], [, b]) => a.vessel.localeCompare(b.vessel, i18n.lang));
		for (const [mixId, mix] of mixes) {
			rows.push({ label: mix.vessel, img: mix.img, plain: false, cells: cells(recipe.id, mixId, mix) });
		}
		const filled = rows.filter(row => row.cells.some(Boolean));
		const total = filled.reduce((sum, row) => sum + row.cells.filter(Boolean).length, 0);
		if (total) {
			tables.push({ id: recipe.id, name: recipe.name, img: recipe.img, total, rows: filled });
		}
	}
	return tables;
}

export function getRecognised(actor) {
	return [...(actor?.getFlag(MODULE_ID, "recognised") ?? [])];
}

export async function setRecognised(actor, key, known) {
	const keys = new Set(getRecognised(actor));
	if (known) {
		keys.add(key);
	} else {
		keys.delete(key);
	}
	await actor.setFlag(MODULE_ID, "recognised", [...keys]);
}

/* -------------------------------------------- */
/*  Research: learning a recipe from a sample    */
/* -------------------------------------------- */

/** The difficulty of researching a recipe: the GM's own number, else the craft difficulty by rarity. */
export function getResearchDifficulty(recipe) {
	return Number(recipe?.researchDifficulty) || getDifficulty(recipe);
}

/** The counter researching a recipe starts at: the GM's own number, else by rarity. */
export function getResearchProgress(recipe) {
	return Number(recipe?.researchProgress) || RESEARCH_PROGRESS[recipe?.rarity] || RESEARCH_PROGRESS.custom;
}

/**
 * The character's research projects: { [recipeId]: { counter } }, what is left of the counter. A project exists once
 * the first attempt is made. Projects saved before the counter counted down have { progress } instead.
 */
export function getProjects(actor) {
	return foundry.utils.deepClone(actor?.getFlag(MODULE_ID, "projects") ?? {});
}

/** What is left of a project's counter, also for projects saved with the old upward progress. */
export function projectCounter(project, needed) {
	if (!project) {
		return needed;
	}
	const value = project.counter ?? needed - (Number(project.progress) || 0);
	return Math.max(0, Math.min(needed, Math.floor(Number(value) || 0)));
}

export async function setProjectCounter(actor, recipeId, counter) {
	await actor.update({
		[`flags.${MODULE_ID}.projects.${recipeId}.counter`]: Math.max(0, Math.floor(Number(counter) || 0)),
		[`flags.${MODULE_ID}.projects.${recipeId}.-=progress`]: null
	});
}

export async function removeProject(actor, recipeId) {
	await actor.update({ [`flags.${MODULE_ID}.projects.-=${recipeId}`]: null });
}

/** An identified item in the inventory that is the recipe's potion: the sample a first research attempt needs. */
export function findSample(actor, recipe) {
	const key = normalizeName(recipe?.result?.name);
	return actor?.items.find(item => {
		if (item.getFlag("mist-age-equipment", "mystery")?.unidentified) {
			return false;
		}
		return normalizeName(item._source?.name ?? item.name) === key;
	}) ?? null;
}

/**
 * The recipes the character can research: not known yet, and either already started or with a sample in the
 * inventory. The GM sees the same list as the player.
 */
export function listResearchable(actor) {
	const known = new Set(getKnownRecipeIds(actor));
	const projects = getProjects(actor);
	return listRecipes().filter(recipe => !known.has(recipe.id) && (recipe.id in projects || findSample(actor, recipe)));
}

/** Quantity of an item; items without the field count as one. */
export function getQuantity(item) {
	const quantity = item.system?.quantity;
	return Number.isFinite(quantity) ? quantity : 1;
}

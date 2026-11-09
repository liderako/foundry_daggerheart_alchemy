import {
	RESEARCH_GAIN, RESEARCH_INGREDIENTS, findSample, getProjects, getResearchDifficulty, getResearchProgress, projectCounter,
	removeProject, setProjectCounter, setRecipeKnown
} from "./data.js";
import { HIDDEN_SLOTS, getDifficulty, getKnownRecipes, comboKey, getMix, getRecognised, potionKey, getQuantity, getRequirement, getTrait, isIngredient, isVessel, normalizeName, vesselAllowed } from "./data.js";

/** Roll outcomes, in the order of the alchemy rules. */
export const OUTCOMES = ["critical", "successHope", "successFear", "failureHope", "failureFear"];

/**
 * How the placed ingredients cover a recipe. Named ingredients are filled first; whatever is left over counts
 * towards "any alchemy ingredient" if it is one, otherwise it is extra and the recipe cannot use it.
 * @param {object} recipe
 * @param {Actor} actor
 * @param {Map<string, number>} placed  item id → units put into the window
 */
export function evaluate(recipe, actor, placed) {
	const requirement = getRequirement(recipe);
	const named = requirement.named.map(entry => ({ ...entry, key: normalizeName(entry.name), have: 0 }));
	let anyHave = 0;
	let extra = 0;
	let count = 0;
	for (const [itemId, units] of placed) {
		const item = actor.items.get(itemId);
		if (!item || units <= 0) {
			continue;
		}
		count += units;
		let left = units;
		const key = normalizeName(item.name);
		for (const entry of named) {
			if (entry.key === key && entry.have < entry.quantity) {
				const take = Math.min(left, entry.quantity - entry.have);
				entry.have += take;
				left -= take;
			}
		}
		if (left > 0) {
			if (isIngredient(item)) {
				anyHave += left;
			} else {
				extra += left;
			}
		}
	}
	const namedDone = named.every(entry => entry.have >= entry.quantity);
	const anyDone = anyHave === requirement.any;
	return {
		requirement,
		named,
		anyHave,
		extra,
		count,
		ready: namedDone && anyDone && extra === 0 && count === requirement.total
	};
}

/** Whether one more unit of this item fits the recipe. */
export function canPlace(recipe, actor, placed, item) {
	if (item.parent !== actor) {
		return false;
	}
	const already = placed.get(item.id) ?? 0;
	if (already >= getQuantity(item)) {
		return false;
	}
	const trial = new Map(placed);
	trial.set(item.id, already + 1);
	const result = evaluate(recipe, actor, trial);
	return result.extra === 0 && result.count <= result.requirement.total && result.anyHave <= result.requirement.any;
}

/** An item the window offers as an ingredient: a registered one or one the selected recipe names. */
export function isUsableIngredient(recipe, item) {
	if (isIngredient(item)) {
		return true;
	}
	const key = normalizeName(item.name);
	return !!recipe && getRequirement(recipe).named.some(entry => normalizeName(entry.name) === key);
}

/** A vessel the recipe accepts (alcohol is refused by a recipe that forbids mixing). Without a recipe: any vessel. */
export function isUsableVessel(item, recipe = null) {
	return recipe ? vesselAllowed(recipe, item) : isVessel(item);
}

function outcomeOf(roll) {
	if (roll.isCritical) {
		return "critical";
	}
	const hope = roll.result?.duality === 1;
	if (roll.success) {
		return hope ? "successHope" : "successFear";
	}
	return hope ? "failureHope" : "failureFear";
}

/** What leaves the inventory: item id → units, ingredients and the vessel together. */
function consumption(placed, vesselId) {
	const use = new Map(placed);
	if (vesselId) {
		use.set(vesselId, (use.get(vesselId) ?? 0) + 1);
	}
	return use;
}

function checkInventory(actor, use) {
	for (const [itemId, units] of use) {
		const item = actor.items.get(itemId);
		if (!item || getQuantity(item) < units) {
			return false;
		}
	}
	return true;
}

async function spend(actor, use) {
	const updates = [];
	const deletions = [];
	for (const [itemId, units] of use) {
		const item = actor.items.get(itemId);
		const left = getQuantity(item) - units;
		if (left > 0) {
			updates.push({ _id: itemId, "system.quantity": left });
		} else {
			deletions.push(itemId);
		}
	}
	if (updates.length) {
		await actor.updateEmbeddedDocuments("Item", updates);
	}
	if (deletions.length) {
		await actor.deleteEmbeddedDocuments("Item", deletions);
	}
}

const EQUIPMENT_ID = "mist-age-equipment";

function isStackable(existing, data) {
	if (existing.type !== data.type || existing._source.name !== data.name) {
		return false;
	}
	if (existing.getFlag(EQUIPMENT_ID, "mystery")?.unidentified) {
		return false;
	}
	return Number.isFinite(existing.system?.quantity);
}

/** Whether the character knows this potion: a known recipe makes it (same uuid, else same name), or the GM marked it as recognised. */
export function knowsPotion(actor, ref) {
	const key = normalizeName(ref?.name ?? ref?.data?.name);
	if (getKnownRecipes(actor).some(known => (ref?.uuid && known.result?.uuid === ref.uuid) || normalizeName(known.result?.name) === key)) {
		return true;
	}
	// Results the GM marked as known to the character (a by-product they have met), without being able to brew them.
	const recognised = new Set(getRecognised(actor));
	return recognised.has(potionKey(ref)) || recognised.has(`name:${key}`);
}

/** The recipe slot an outcome reads. */
function slotOf(outcome) {
	if (outcome === "critical") {
		return "enhanced";
	}
	return HIDDEN_SLOTS.has(outcome) ? outcome : "result";
}

/**
 * Which potion an outcome gives.
 * Without a mix: the outcome's own potion, else the recipe potion.
 * With a mix (the vessel is an alcohol that has its own table in the recipe): the mix's potion for the outcome,
 * else the recipe potion.
 * Returns { ref, slot, hidden, shown }: hidden on alcohol always, otherwise only for the by-products; shown is what a
 * hidden potion goes by (the recipe's potion).
 */
export function potionFor(recipe, outcome, mix = null) {
	const slot = slotOf(outcome);
	const table = mix ?? recipe;
	const own = table[slot]?.data ? table[slot] : null;
	const ref = own ?? (mix?.result?.data ? mix.result : recipe.result);
	const usedSlot = own ? slot : "result";
	// Without alcohol only the by-products are hidden; on alcohol every outcome is, until the character knows it.
	// A hidden potion goes by the recipe's own potion.
	return { ref, slot: usedSlot, hidden: mix ? true : HIDDEN_SLOTS.has(usedSlot), shown: recipe.result };
}

/**
 * Puts one potion into the inventory. A hidden variant arrives unidentified (the Equipment module's mystery item),
 * going by the recipe potion's name and picture, and never joins a stack; any other potion joins a stack of the same.
 */
async function givePotion(actor, recipe, ref, hidden, shown) {
	const data = foundry.utils.deepClone(ref.data);
	if (!hidden) {
		const stack = actor.items.find(existing => isStackable(existing, data));
		if (stack) {
			await stack.update({ "system.quantity": stack.system.quantity + 1 });
			return stack;
		}
	}
	if (data.system && "quantity" in data.system) {
		data.system.quantity = 1;
	}
	if (hidden) {
		foundry.utils.setProperty(data, `flags.${EQUIPMENT_ID}.mystery`, {
			unidentified: true,
			name: shown?.name ?? recipe.result?.name ?? recipe.name,
			img: shown?.img ?? recipe.result?.img ?? recipe.img
		});
		if (data.system && "equipped" in data.system) {
			data.system.equipped = false;
		}
	}
	const [created] = await actor.createEmbeddedDocuments("Item", [data]);
	return created;
}

/** "Bone Dust ×2, Empty Vial ×1": what the brew takes, written before the items are spent. */
function spentList(actor, use) {
	const parts = [];
	for (const [itemId, units] of use) {
		const item = actor.items.get(itemId);
		if (item) {
			parts.push(`${foundry.utils.escapeHTML(item.name)} ×${units}`);
		}
	}
	return parts.join(", ");
}

async function postChat(actor, recipe, outcome, potion, spent, enhancedMissing, mix, recognised) {
	const i18n = game.i18n;
	const difficulty = getDifficulty(recipe);
	const name = foundry.utils.escapeHTML(potion?.name ?? recipe.name);
	const img = potion?.img ?? recipe.img;
	const note = enhancedMissing ? `<p class="hint">${i18n.localize("MIST_ALCHEMY.Chat.EnhancedMissing")}</p>` : "";
	const known = recognised ? `<p class="mist-alchemy-recognised">${i18n.format("MIST_ALCHEMY.Chat.Recognised", { actor: foundry.utils.escapeHTML(actor.name), name: foundry.utils.escapeHTML(potion?.name ?? "") })}</p>` : "";
	const mixed = mix ? `<p class="mist-alchemy-mixed">${i18n.format("MIST_ALCHEMY.Chat.Mixed", { vessel: foundry.utils.escapeHTML(mix.vessel) })}</p>` : "";
	const content = `
		<div class="mist-alchemy-chat ${outcome}">
			<header>
				<img src="${img}" alt="">
				<div>
					<h3>${name}</h3>
					<span>${i18n.format("MIST_ALCHEMY.Chat.Difficulty", { difficulty })}</span>
				</div>
			</header>
			${mixed}
			<p class="mist-alchemy-outcome">${i18n.localize(`MIST_ALCHEMY.Outcome.${outcome}.Label`)}</p>
			<p>${i18n.localize(`MIST_ALCHEMY.Outcome.${outcome}.Text`)}</p>
			${known}
			${note}
			<p class="mist-alchemy-spent">${i18n.format("MIST_ALCHEMY.Chat.Spent", { items: spent })}</p>
		</div>`;
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content
	});
}

/**
 * Brews a potion: checks the inventory, makes the action roll against the recipe's difficulty, then spends the
 * ingredients and the vessel and puts the potion into the inventory. Returns null when nothing happened
 * (the roll dialog was closed or the items are gone), otherwise the outcome.
 */
export async function brew(actor, recipe, placed, vesselId) {
	const i18n = game.i18n;
	const state = evaluate(recipe, actor, placed);
	const vessel = vesselId ? actor.items.get(vesselId) : null;
	if (!state.ready || !vessel || !vesselAllowed(recipe, vessel)) {
		ui.notifications.warn("MIST_ALCHEMY.Craft.NotReady", { localize: true });
		return null;
	}
	const use = consumption(placed, vesselId);
	if (!checkInventory(actor, use)) {
		ui.notifications.warn("MIST_ALCHEMY.Craft.ItemsGone", { localize: true });
		return null;
	}

	const trait = getTrait();
	const difficulty = getDifficulty(recipe);
	const result = await actor.rollTrait(trait, {
		title: i18n.format("MIST_ALCHEMY.Craft.RollTitle", { potion: recipe.name }),
		headerTitle: i18n.format("MIST_ALCHEMY.Craft.RollHeader", { actor: actor.name }),
		roll: { trait, type: "trait", difficulty }
	});
	if (!result) {
		return null;
	}
	const costs = result.costs?.filter(cost => cost.enabled).map(cost => ({ ...cost, value: -cost.value })) ?? [];
	result.resourceUpdates?.addResources(costs);
	await result.resourceUpdates?.updateResources();
	await freeActions()?.spend(actor, i18n.format("MIST_ALCHEMY.Free.Brew", { name: recipe.name }));

	const outcome = outcomeOf(result.roll);
	// The roll may have taken a while (dialog, dice animation): check again before spending.
	if (!checkInventory(actor, use)) {
		ui.notifications.warn("MIST_ALCHEMY.Craft.ItemsGone", { localize: true });
		return null;
	}
	const spent = spentList(actor, use);
	const mix = getMix(recipe, actor.items.get(vesselId));
	await spend(actor, use);
	const variant = potionFor(recipe, outcome, mix);
	const { ref, slot, shown } = variant;
	// A character who knows the recipe of what came out recognises it: it is not hidden.
	const recognised = variant.hidden && (knowsPotion(actor, ref) || getRecognised(actor).includes(comboKey(recipe.id, mix?.id, slot)));
	const hidden = variant.hidden && !recognised;
	if (hidden && !game.modules.get(EQUIPMENT_ID)?.active) {
		ui.notifications.warn("MIST_ALCHEMY.Craft.NoEquipmentModule", { localize: true });
	}
	const potion = await givePotion(actor, recipe, ref, hidden, shown);
	await postChat(actor, recipe, outcome, potion, spent, outcome === "critical" && slot !== "enhanced", mix, recognised);
	if (hidden) {
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			whisper: ChatMessage.getWhisperRecipients("GM").map(user => user.id),
			content: `<p>${game.i18n.format("MIST_ALCHEMY.Chat.HiddenForGM", {
				actor: foundry.utils.escapeHTML(actor.name),
				real: foundry.utils.escapeHTML(ref.name ?? ref.data?.name ?? ""),
				shown: foundry.utils.escapeHTML(potion?.name ?? "")
			})}</p>`
		});
	}
	return outcome;
}

/* -------------------------------------------- */
/*  Research                                     */
/* -------------------------------------------- */

/** What a research attempt puts on the table: any alchemy ingredients, no vessel. */
export function researchTable(recipe) {
	return recipe ? { ...recipe, ingredients: [], anyIngredients: RESEARCH_INGREDIENTS, mixes: {} } : null;
}

/** The state of a research project: its counter (counting down), where it starts, whether the first attempt (which needs a sample) is still ahead. */
export function researchState(actor, recipe) {
	const project = getProjects(actor)[recipe.id];
	return {
		started: !!project,
		counter: projectCounter(project, getResearchProgress(recipe)),
		needed: getResearchProgress(recipe),
		difficulty: getResearchDifficulty(recipe),
		sample: findSample(actor, recipe)
	};
}

/**
 * One research attempt: needs the ingredients (and, on the first attempt, a sample of the potion, which is spent), makes the
 * Knowledge action roll against the research difficulty, spends the ingredients and moves the counter down (or back
 * up). At 0 the character learns the recipe. Returns the outcome, or null when nothing happened.
 */
export async function research(actor, recipe, placed) {
	const i18n = game.i18n;
	const table = researchTable(recipe);
	const before = researchState(actor, recipe);
	if (!evaluate(table, actor, placed).ready) {
		ui.notifications.warn("MIST_ALCHEMY.Research.NotReady", { localize: true });
		return null;
	}
	if (!before.started && !before.sample) {
		ui.notifications.warn(i18n.format("MIST_ALCHEMY.Research.NeedSample", { name: recipe.name }));
		return null;
	}
	const use = new Map(placed);
	// The first attempt takes the sample apart: it is spent with the ingredients.
	if (!before.started) {
		use.set(before.sample.id, (use.get(before.sample.id) ?? 0) + 1);
	}
	if (!checkInventory(actor, use)) {
		ui.notifications.warn("MIST_ALCHEMY.Craft.ItemsGone", { localize: true });
		return null;
	}

	const trait = getTrait();
	const result = await actor.rollTrait(trait, {
		title: i18n.format("MIST_ALCHEMY.Research.RollTitle", { potion: recipe.name }),
		headerTitle: i18n.format("MIST_ALCHEMY.Craft.RollHeader", { actor: actor.name }),
		roll: { trait, type: "trait", difficulty: before.difficulty }
	});
	if (!result) {
		return null;
	}
	const costs = result.costs?.filter(cost => cost.enabled).map(cost => ({ ...cost, value: -cost.value })) ?? [];
	result.resourceUpdates?.addResources(costs);
	await result.resourceUpdates?.updateResources();
	await freeActions()?.spend(actor, i18n.format("MIST_ALCHEMY.Free.Research", { name: recipe.name }));

	const outcome = outcomeOf(result.roll);
	if (!checkInventory(actor, use)) {
		ui.notifications.warn("MIST_ALCHEMY.Craft.ItemsGone", { localize: true });
		return null;
	}
	const spent = spentList(actor, use);
	await spend(actor, use);

	const gain = RESEARCH_GAIN[outcome] ?? 0;
	const counter = Math.max(0, Math.min(before.needed, before.counter - gain));
	const learnt = counter <= 0;
	if (learnt) {
		await setRecipeKnown(actor, recipe.id, true);
		await removeProject(actor, recipe.id);
	} else {
		await setProjectCounter(actor, recipe.id, counter);
	}

	const escape = foundry.utils.escapeHTML;
	const gainText = gain > 0 ? `−${gain}` : gain < 0 ? `+${-gain}` : "0";
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `
			<div class="mist-alchemy-chat ${outcome}">
				<header>
					<img src="${recipe.img}" alt="">
					<div>
						<h3>${i18n.format("MIST_ALCHEMY.Research.ChatTitle", { name: escape(recipe.name) })}</h3>
						<span>${i18n.format("MIST_ALCHEMY.Chat.Difficulty", { difficulty: before.difficulty })}</span>
					</div>
				</header>
				<p class="mist-alchemy-outcome">${i18n.localize(`MIST_ALCHEMY.Outcome.${outcome}.Label`)}: ${gainText}</p>
				<p>${learnt
					? i18n.format("MIST_ALCHEMY.Research.Learnt", { actor: escape(actor.name), name: escape(recipe.name) })
					: i18n.format("MIST_ALCHEMY.Research.Progress", { counter, needed: before.needed })}</p>
				<p class="mist-alchemy-spent">${i18n.format("MIST_ALCHEMY.Chat.Spent", { items: spent })}</p>
			</div>`
	});
	return outcome;
}

/** The Mist Age - Free Actions, when it is active: every downtime roll spends one free action (none at 0). */
export function freeActions() {
	const module = game.modules.get("mist-age-free-actions");
	return module?.active ? module.api ?? null : null;
}

/** "Free actions: 19" for the roll buttons, or null without the module. */
export function freeActionsLine(actor) {
	const api = freeActions();
	return api ? game.i18n.format("MIST_FREE.Line", { count: api.get(actor) }) : null;
}

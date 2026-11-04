import { MODULE_ID } from "./data.js";

/**
 * Resources an item gives its user whenever one of its actions is used, beyond what Daggerheart actions can do
 * (an attack with a reaction roll cannot also grant Hope). Set on the item as
 * flags["mist-age-alchemy"].onUse = { hope: 1, stress: -1, fear: 1, ... }: positive gains, negative loses; clamped to
 * 0..max. Fear is the GM's pool.
 */
const RESOURCES = ["hope", "stress", "hitPoints"];

async function onPostUseAction(action) {
	const item = action?.item;
	const actor = action?.actor;
	const gains = item?.flags?.[MODULE_ID]?.onUse;
	if (!gains || !actor?.isOwner || actor.type !== "character") {
		return;
	}
	const updates = {};
	const parts = [];
	for (const key of RESOURCES) {
		const amount = Number(gains[key]) || 0;
		const resource = actor.system.resources?.[key];
		if (!amount || !resource) {
			continue;
		}
		const value = Math.clamp(resource.value + amount, 0, resource.max ?? Infinity);
		if (value === resource.value) {
			continue;
		}
		updates[`system.resources.${key}.value`] = value;
		parts.push(`${amount > 0 ? "+" : ""}${amount} ${game.i18n.localize(`MIST_ALCHEMY.Resource.${key}`)}`);
	}
	// Fear belongs to the GM: Daggerheart passes a player's change on to the GM.
	const fear = Number(gains.fear) || 0;
	if (fear) {
		await actor.modifyResource([{ key: "fear", value: fear }]);
		parts.push(`${fear > 0 ? "+" : ""}${fear} ${game.i18n.localize("MIST_ALCHEMY.Resource.fear")}`);
	}
	if (!parts.length) {
		return;
	}
	if (!foundry.utils.isEmpty(updates)) {
		await actor.update(updates);
	}
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `<p>${game.i18n.format("MIST_ALCHEMY.Chat.OnUse", { item: foundry.utils.escapeHTML(item.name), changes: parts.join(", ") })}</p>`
	});
}

export function registerOnUse() {
	Hooks.on("daggerheart.postUseAction", onPostUseAction);
}

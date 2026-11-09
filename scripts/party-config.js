import { MODULE_ID, canCraft } from "./data.js";

// Shared potion knowledge: groups of characters who share what they learn by drinking. When a member of a group drinks
// a hidden potion, the other members with alchemy learn it too. Any number of groups (a campaign party, a one-shot
// party); a character may be in several. Nothing else uses them.
// { [id]: { name, members: [actorId] } }
const GROUPS = "groups";
// The single list of the first version, turned into the first group.
const OLD_PARTY = "party";

export function registerPartySetting() {
	game.settings.register(MODULE_ID, GROUPS, {
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});
	game.settings.register(MODULE_ID, OLD_PARTY, {
		scope: "world",
		config: false,
		type: Array,
		default: []
	});
	game.settings.registerMenu(MODULE_ID, "partyConfig", {
		name: "MIST_ALCHEMY.Settings.Party.Name",
		label: "MIST_ALCHEMY.Settings.Party.Label",
		hint: "MIST_ALCHEMY.Settings.Party.Hint",
		icon: "fa-solid fa-users",
		type: PartyConfig,
		restricted: true
	});
}

/** The groups: { [id]: { name, members } }. */
export function getGroups() {
	const groups = foundry.utils.deepClone(game.settings.get(MODULE_ID, GROUPS) ?? {});
	const old = game.settings.get(MODULE_ID, OLD_PARTY) ?? [];
	if (!Object.keys(groups).length && old.length) {
		groups.party = { name: game.i18n.localize("MIST_ALCHEMY.Party.DefaultName"), members: [...old] };
	}
	return groups;
}

async function setGroups(groups) {
	await game.settings.set(MODULE_ID, GROUPS, groups);
	if ((game.settings.get(MODULE_ID, OLD_PARTY) ?? []).length) {
		await game.settings.set(MODULE_ID, OLD_PARTY, []);
	}
}

/** The characters with alchemy who share a group with the drinker, not counting the drinker. */
export function partyAlchemists(actor) {
	const ids = new Set();
	for (const group of Object.values(getGroups())) {
		const members = group.members ?? [];
		if (members.includes(actor.id)) {
			members.forEach(id => ids.add(id));
		}
	}
	ids.delete(actor.id);
	return [...ids].map(id => game.actors.get(id)).filter(member => member && canCraft(member));
}

const { ApplicationV2 } = foundry.applications.api;

/** The GM's window from the module settings: every group with its name and a checkbox per character. */
export class PartyConfig extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-party`,
		classes: ["mist-alchemy", "mist-alchemy-party"],
		window: { title: "MIST_ALCHEMY.Party.Title", icon: "fa-solid fa-users", resizable: true },
		position: { width: 460, height: "auto" }
	};

	/** Player characters and characters with alchemy, plus anyone already in a group. */
	static #characters(groups) {
		const listed = new Set(Object.values(groups).flatMap(group => group.members ?? []));
		return game.actors
			.filter(actor => actor.type === "character" && (actor.hasPlayerOwner || canCraft(actor) || listed.has(actor.id)))
			.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
	}

	async _renderHTML() {
		const escape = foundry.utils.escapeHTML;
		const localize = key => game.i18n.localize(`MIST_ALCHEMY.Party.${key}`);
		const groups = getGroups();
		const characters = PartyConfig.#characters(groups);
		const flask = escape(game.i18n.localize("MIST_ALCHEMY.Actor.Enabled"));
		const sections = Object.entries(groups).map(([id, group]) => {
			const members = new Set(group.members ?? []);
			const rows = characters.map(actor => `
				<label class="mist-alchemy-party-row">
					<input type="checkbox" data-member="${actor.id}" ${members.has(actor.id) ? "checked" : ""}>
					<img src="${escape(actor.img)}" alt="">
					<span>${escape(actor.name)}</span>
					${canCraft(actor) ? `<i class="fa-solid fa-flask" inert data-tooltip="${flask}"></i>` : ""}
				</label>`).join("");
			return `<fieldset class="mist-alchemy-party-group" data-group-id="${id}">
				<legend>
					<input type="text" class="mist-alchemy-party-name" value="${escape(group.name ?? "")}" placeholder="${escape(localize("NamePlaceholder"))}">
					<a class="mist-alchemy-party-delete" data-tooltip="${escape(localize("Delete"))}"><i class="fa-solid fa-trash" inert></i></a>
				</legend>
				${rows || `<p class="hint">${game.i18n.localize("MIST_ALCHEMY.Hub.NoCharacters")}</p>`}
			</fieldset>`;
		}).join("");
		return `<div class="mist-alchemy-party-body">
			<p class="hint">${localize("Hint")}</p>
			${sections || `<p class="hint">${localize("Empty")}</p>`}
			<button type="button" class="mist-alchemy-party-add"><i class="fa-solid fa-plus" inert></i> ${localize("Add")}</button>
		</div>`;
	}

	_replaceHTML(result, content) {
		content.innerHTML = result;
		const update = async change => {
			const groups = getGroups();
			change(groups);
			await setGroups(groups);
			this.render();
		};
		content.querySelector(".mist-alchemy-party-add")?.addEventListener("click", () => update(groups => {
			groups[foundry.utils.randomID()] = { name: game.i18n.localize("MIST_ALCHEMY.Party.NewName"), members: [] };
		}));
		for (const section of content.querySelectorAll("[data-group-id]")) {
			const id = section.dataset.groupId;
			section.querySelector(".mist-alchemy-party-name")?.addEventListener("change", event => update(groups => {
				if (groups[id]) {
					groups[id].name = event.target.value.trim();
				}
			}));
			section.querySelector(".mist-alchemy-party-delete")?.addEventListener("click", async () => {
				const name = foundry.utils.escapeHTML(getGroups()[id]?.name ?? "");
				const sure = await foundry.applications.api.DialogV2.confirm({
					window: { title: game.i18n.localize("MIST_ALCHEMY.Party.Delete") },
					content: `<p>${game.i18n.format("MIST_ALCHEMY.Party.DeleteConfirm", { name })}</p>`
				});
				if (sure) {
					await update(groups => {
						delete groups[id];
					});
				}
			});
			for (const input of section.querySelectorAll("input[data-member]")) {
				input.addEventListener("change", () => update(groups => {
					const members = new Set(groups[id]?.members ?? []);
					if (input.checked) {
						members.add(input.dataset.member);
					} else {
						members.delete(input.dataset.member);
					}
					if (groups[id]) {
						groups[id].members = [...members];
					}
				}));
			}
		}
	}
}

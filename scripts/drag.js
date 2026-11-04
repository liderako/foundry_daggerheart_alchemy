/** All items in an Item folder and its subfolders. */
function folderItems(folder) {
	const items = [...folder.contents];
	for (const child of folder.getSubfolders?.(true) ?? []) {
		items.push(...child.contents);
	}
	return items.filter(entry => entry instanceof Item);
}

/**
 * The items a drag event carries: one item, or every item of a dropped Item folder. Compendium folders give
 * index entries, so their items are loaded first.
 */
export async function droppedItems(event) {
	const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
	if (!data?.uuid) {
		return [];
	}
	const document = await fromUuid(data.uuid).catch(() => null);
	if (document instanceof Item) {
		return [document];
	}
	if (document instanceof Folder && document.type === "Item") {
		if (document.pack) {
			const pack = game.packs.get(document.pack);
			const ids = pack?.index.filter(entry => entry.folder === document.id).map(entry => entry._id) ?? [];
			return Promise.all(ids.map(id => pack.getDocument(id)));
		}
		return folderItems(document);
	}
	return [];
}

/**
 * Makes every element matching the selector a drop target: highlighted while something is dragged over it,
 * calling onDrop(items, zone, event) with the dropped items.
 */
export function bindDropZones(root, selector, onDrop) {
	for (const zone of root.querySelectorAll(selector)) {
		zone.addEventListener("dragenter", event => event.preventDefault());
		zone.addEventListener("dragover", event => {
			event.preventDefault();
			zone.classList.add("drag-over");
		});
		zone.addEventListener("dragleave", event => {
			if (!zone.contains(event.relatedTarget)) {
				zone.classList.remove("drag-over");
			}
		});
		zone.addEventListener("drop", async event => {
			event.preventDefault();
			event.stopPropagation();
			zone.classList.remove("drag-over");
			const items = await droppedItems(event);
			if (!items.length) {
				ui.notifications.warn("MIST_ALCHEMY.Drop.NotItem", { localize: true });
				return;
			}
			await onDrop(items, zone, event);
		});
	}
}

/** Lets elements with data-drag-uuid be dragged out as items. */
export function bindDragSources(root) {
	for (const source of root.querySelectorAll("[data-drag-uuid]")) {
		source.setAttribute("draggable", "true");
		source.addEventListener("dragstart", event => {
			event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: source.dataset.dragUuid }));
		});
	}
}

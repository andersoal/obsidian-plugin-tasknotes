/* eslint-disable @microsoft/sdl/no-inner-html */
import { App, Modal, Notice, Setting } from "obsidian";
import { TimeEntry, TaskInfo } from "../types";
import type TaskNotesPlugin from "../main";
import { TranslationKey } from "../i18n";

type ViewMode = "form" | "table";

export class TimeEntryEditorModal extends Modal {
	private plugin: TaskNotesPlugin;
	private task: TaskInfo;
	private timeEntries: TimeEntry[];
	private onSave: (timeEntries: TimeEntry[]) => void;
	private translate: (key: TranslationKey, variables?: Record<string, any>) => string;
	private entriesContainerEl: HTMLElement;
	private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

	/** Current view mode for this session (defaults from plugin settings) */
	private viewMode: ViewMode;

	/** Index of the row being expanded inline in table mode (-1 = none) */
	private expandedRowIndex: number = -1;

	constructor(
		app: App,
		plugin: TaskNotesPlugin,
		task: TaskInfo,
		onSave: (timeEntries: TimeEntry[]) => void
	) {
		super(app);
		this.plugin = plugin;
		this.task = task;
		// Create a working copy of time entries
		this.timeEntries = JSON.parse(JSON.stringify(task.timeEntries || []));
		this.onSave = onSave;
		this.translate = plugin.i18n.translate.bind(plugin.i18n);
		// Initialise view mode from plugin setting (user can toggle in-modal)
		this.viewMode = (plugin.settings.timeEntryEditorStyle as ViewMode) ?? "form";
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("time-entry-editor-modal");

		// Modal title
		this.titleEl.setText(
			this.translate("modals.timeEntryEditor.title", { taskTitle: this.task.title })
		);

		// Add global keyboard shortcut handler for CMD/Ctrl+Enter
		this.keyboardHandler = (e: KeyboardEvent) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.save();
			}
		};
		this.containerEl.addEventListener("keydown", this.keyboardHandler);

		// ── Toolbar: view toggle button ──────────────────────────────────
		const toolbar = contentEl.createDiv({ cls: "time-entry-editor-modal__toolbar" });
		const viewToggleBtn = toolbar.createEl("button", {
			cls: "time-entry-editor-modal__view-toggle",
			text:
				this.viewMode === "form"
					? this.translate("modals.timeEntryEditor.switchToTable")
					: this.translate("modals.timeEntryEditor.switchToForm"),
		});
		viewToggleBtn.addEventListener("click", () => {
			this.viewMode = this.viewMode === "form" ? "table" : "form";
			this.expandedRowIndex = -1;
			this.refreshAll();
		});

		// ── Entries container ────────────────────────────────────────────
		this.entriesContainerEl = contentEl.createDiv({ cls: "time-entry-editor-modal__entries" });
		this.renderEntries();

		// ── Add new entry button ─────────────────────────────────────────
		const addButtonContainer = contentEl.createDiv({
			cls: "time-entry-editor-modal__add-button-container",
		});
		const addButton = addButtonContainer.createEl("button", {
			text: this.translate("modals.timeEntryEditor.addEntry"),
			cls: "mod-cta",
		});
		addButton.addEventListener("click", () => this.addNewEntry());

		// ── Footer ───────────────────────────────────────────────────────
		this.renderFooter(contentEl);
	}

	// ────────────────────────────────────────────────────────────────────────
	// Rendering
	// ────────────────────────────────────────────────────────────────────────

	private refreshAll() {
		// Re-render only the entries container (keep toolbar and footer intact)
		this.entriesContainerEl.empty();
		this.renderEntries();

		// Update toggle button label
		const btn = this.contentEl.querySelector(
			".time-entry-editor-modal__view-toggle"
		) as HTMLButtonElement | null;
		if (btn) {
			btn.textContent =
				this.viewMode === "form"
					? this.translate("modals.timeEntryEditor.switchToTable")
					: this.translate("modals.timeEntryEditor.switchToForm");
		}

		// Refresh total in footer
		const totalEl = this.contentEl.querySelector(
			".time-entry-editor-modal__total"
		) as HTMLElement | null;
		if (totalEl) {
			totalEl.textContent = this.buildTotalText();
		}
	}

	private renderEntries() {
		if (this.timeEntries.length === 0) {
			this.entriesContainerEl.createDiv({
				cls: "time-entry-editor-modal__empty",
				text: this.translate("modals.timeEntryEditor.noEntries"),
			});
			return;
		}

		// Build a display-order array (newest first) mapped back to original indices
		const sorted = this.timeEntries
			.map((entry, idx) => ({ entry, idx }))
			.sort(
				(a, b) =>
					new Date(b.entry.startTime).getTime() - new Date(a.entry.startTime).getTime()
			);

		if (this.viewMode === "form") {
			sorted.forEach(({ entry, idx }) => this.renderEntryForm(entry, idx));
		} else {
			this.renderTableView(sorted);
		}
	}

	// ── Form view ──────────────────────────────────────────────────────────

	private renderEntryForm(entry: TimeEntry, index: number) {
		const entryEl = this.entriesContainerEl.createDiv({ cls: "time-entry-editor-modal__entry" });

		// Header
		const headerEl = entryEl.createDiv({ cls: "time-entry-editor-modal__entry-header" });
		const dateStr = new Date(entry.startTime).toLocaleDateString();
		headerEl.createSpan({
			cls: "time-entry-editor-modal__entry-date",
			text: dateStr,
		});
		this.appendDeleteButton(headerEl, index);

		// Time inputs
		const timeContainer = entryEl.createDiv({ cls: "time-entry-editor-modal__time-container" });
		this.appendStartTimeInput(timeContainer, entry);
		this.appendEndTimeInput(timeContainer, entry);
		this.appendDescriptionInput(timeContainer, entry);
	}

	// ── Table view ─────────────────────────────────────────────────────────

	private renderTableView(sorted: Array<{ entry: TimeEntry; idx: number }>) {
		const table = this.entriesContainerEl.createEl("table", {
			cls: "time-entry-editor-modal__table",
		});

		// Header
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		const headers = [
			this.translate("modals.timeEntryEditor.tableHeaderDate"),
			this.translate("modals.timeEntryEditor.tableHeaderStart"),
			this.translate("modals.timeEntryEditor.tableHeaderEnd"),
			this.translate("modals.timeEntryEditor.tableHeaderDuration"),
			this.translate("modals.timeEntryEditor.tableHeaderDescription"),
			"", // delete column
		];
		headers.forEach((h) => {
			const th = headerRow.createEl("th");
			th.textContent = h;
		});

		// Body
		const tbody = table.createEl("tbody");
		sorted.forEach(({ entry, idx }) => {
			this.renderTableRow(tbody, entry, idx);
		});

		// Hint
		if (this.timeEntries.length > 0) {
			const hint = this.entriesContainerEl.createDiv({
				cls: "time-entry-editor-modal__table-hint",
				text: this.translate("modals.timeEntryEditor.tableClickToEdit"),
			});
			hint.setAttribute("aria-live", "polite");
		}
	}

	private renderTableRow(tbody: HTMLElement, entry: TimeEntry, index: number) {
		const isExpanded = this.expandedRowIndex === index;

		// ── Summary row ──────────────────────────────────────────────────
		const tr = tbody.createEl("tr", {
			cls:
				"time-entry-editor-modal__table-row" +
				(isExpanded ? " time-entry-editor-modal__table-row--expanded" : ""),
		});
		tr.setAttribute("role", "button");
		tr.setAttribute("tabindex", "0");
		tr.setAttribute("aria-expanded", String(isExpanded));

		const durationMins = this.calculateDuration(entry);
		const startDate = new Date(entry.startTime);

		this.createTableCell(tr, startDate.toLocaleDateString());
		this.createTableCell(tr, this.formatTime12(startDate));
		this.createTableCell(
			tr,
			entry.endTime
				? this.formatTime12(new Date(entry.endTime))
				: this.translate("modals.timeEntryEditor.tableRunning")
		);
		this.createTableCell(tr, `${durationMins}m`);
		this.createTableCell(
			tr,
			entry.description
				? entry.description.length > 30
					? entry.description.slice(0, 30) + "…"
					: entry.description
				: "—"
		);

		// Delete button cell
		const deleteTd = tr.createEl("td", { cls: "time-entry-editor-modal__table-cell time-entry-editor-modal__table-cell--action" });
		this.appendDeleteButton(deleteTd, index);

		// Click / keyboard to expand
		const expandRow = () => {
			this.expandedRowIndex = isExpanded ? -1 : index;
			this.refreshAll();
		};
		tr.addEventListener("click", (e) => {
			// Don't expand when clicking the delete button
			if ((e.target as HTMLElement).closest(".time-entry-editor-modal__delete-button")) return;
			expandRow();
		});
		tr.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				expandRow();
			}
		});

		// ── Expanded edit row (inline, spans full width) ─────────────────
		if (isExpanded) {
			const editTr = tbody.createEl("tr", {
				cls: "time-entry-editor-modal__table-edit-row",
			});
			const editTd = editTr.createEl("td");
			editTd.setAttribute("colspan", "6");

			const editForm = editTd.createDiv({ cls: "time-entry-editor-modal__inline-form" });
			const timeContainer = editForm.createDiv({ cls: "time-entry-editor-modal__time-container" });
			this.appendStartTimeInput(timeContainer, entry);
			this.appendEndTimeInput(timeContainer, entry);
			this.appendDescriptionInput(timeContainer, entry);
		}
	}

	private createTableCell(row: HTMLElement, text: string) {
		const td = row.createEl("td", { cls: "time-entry-editor-modal__table-cell" });
		td.textContent = text;
		return td;
	}

	// ── Shared field builders ──────────────────────────────────────────────

	private appendStartTimeInput(container: HTMLElement, entry: TimeEntry) {
		const startSetting = new Setting(container).setName(
			this.translate("modals.timeEntryEditor.startTime")
		);
		const startInput = startSetting.controlEl.createEl("input", {
			type: "datetime-local",
			cls: "time-entry-editor-modal__datetime-input",
		});
		startInput.value = this.formatDateTimeForInput(new Date(entry.startTime));
		startInput.addEventListener("change", () => {
			const newDate = new Date(startInput.value);
			if (!isNaN(newDate.getTime())) {
				entry.startTime = newDate.toISOString();
			}
		});
	}

	private appendEndTimeInput(container: HTMLElement, entry: TimeEntry) {
		const endSetting = new Setting(container).setName(
			this.translate("modals.timeEntryEditor.endTime")
		);
		const endInput = endSetting.controlEl.createEl("input", {
			type: "datetime-local",
			cls: "time-entry-editor-modal__datetime-input",
		});
		if (entry.endTime) {
			endInput.value = this.formatDateTimeForInput(new Date(entry.endTime));
		}
		endInput.addEventListener("change", () => {
			if (endInput.value) {
				const newDate = new Date(endInput.value);
				if (!isNaN(newDate.getTime())) {
					entry.endTime = newDate.toISOString();
				}
			} else {
				entry.endTime = undefined;
			}
		});
	}

	private appendDescriptionInput(container: HTMLElement, entry: TimeEntry) {
		new Setting(container)
			.setName(this.translate("modals.timeEntryEditor.description"))
			.addTextArea((text) => {
				text.setValue(entry.description || "")
					.setPlaceholder(
						this.translate("modals.timeEntryEditor.descriptionPlaceholder")
					)
					.onChange((value) => {
						entry.description = value || undefined;
					});
				text.inputEl.rows = 2;
			});
	}

	private appendDeleteButton(container: HTMLElement, index: number) {
		const deleteButton = container.createEl("button", {
			cls: "time-entry-editor-modal__delete-button",
			attr: { "aria-label": this.translate("modals.timeEntryEditor.deleteEntry") },
		});
		deleteButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
		deleteButton.addEventListener("click", (e) => {
			e.stopPropagation();
			this.deleteEntry(index);
		});
	}

	// ── Footer ─────────────────────────────────────────────────────────────

	private renderFooter(contentEl: HTMLElement) {
		const footer = contentEl.createDiv({ cls: "time-entry-editor-modal__footer" });

		footer.createDiv({
			cls: "time-entry-editor-modal__total",
			text: this.buildTotalText(),
		});

		const buttonContainer = footer.createDiv({ cls: "time-entry-editor-modal__buttons" });

		const cancelButton = buttonContainer.createEl("button", {
			text: this.translate("common.cancel"),
		});
		cancelButton.addEventListener("click", () => this.close());

		const saveButton = buttonContainer.createEl("button", {
			text: this.translate("common.save"),
			cls: "mod-cta",
		});
		saveButton.addEventListener("click", () => this.save());
	}

	// ────────────────────────────────────────────────────────────────────────
	// Data helpers
	// ────────────────────────────────────────────────────────────────────────

	private calculateDuration(entry: TimeEntry): number {
		if (!entry.endTime) {
			const now = new Date();
			const start = new Date(entry.startTime);
			return Math.round((now.getTime() - start.getTime()) / 60000);
		}
		const start = new Date(entry.startTime);
		const end = new Date(entry.endTime);
		return Math.round((end.getTime() - start.getTime()) / 60000);
	}

	private calculateTotalMinutes(): number {
		return this.timeEntries.reduce((total, entry) => {
			return total + this.calculateDuration(entry);
		}, 0);
	}

	private buildTotalText(): string {
		const totalMinutes = this.calculateTotalMinutes();
		const totalHours = Math.floor(totalMinutes / 60);
		const remainingMinutes = totalMinutes % 60;
		return totalHours > 0
			? this.translate("modals.timeEntryEditor.totalTime", {
					hours: totalHours.toString(),
					minutes: remainingMinutes.toString(),
			  })
			: this.translate("modals.timeEntryEditor.totalMinutes", {
					minutes: totalMinutes.toString(),
			  });
	}

	private addNewEntry() {
		const now = new Date();
		const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
		const newEntry: TimeEntry = {
			startTime: oneHourAgo.toISOString(),
			endTime: now.toISOString(),
			description: "",
		};
		this.timeEntries.push(newEntry);
		// In table mode, auto-expand the new entry for immediate editing
		this.expandedRowIndex = this.timeEntries.length - 1;
		this.refreshAll();
	}

	private deleteEntry(index: number) {
		this.timeEntries.splice(index, 1);
		if (this.expandedRowIndex === index) {
			this.expandedRowIndex = -1;
		} else if (this.expandedRowIndex > index) {
			this.expandedRowIndex--;
		}
		this.refreshAll();
	}

	// ────────────────────────────────────────────────────────────────────────
	// Formatting helpers
	// ────────────────────────────────────────────────────────────────────────

	private formatDateTimeForInput(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hours = String(date.getHours()).padStart(2, "0");
		const minutes = String(date.getMinutes()).padStart(2, "0");
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}

	private formatTime12(date: Date): string {
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	// ────────────────────────────────────────────────────────────────────────
	// Save / Close
	// ────────────────────────────────────────────────────────────────────────

	private save() {
		for (const entry of this.timeEntries) {
			if (!entry.startTime) {
				new Notice(this.translate("modals.timeEntryEditor.validation.missingStartTime"));
				return;
			}
			if (entry.endTime) {
				const start = new Date(entry.startTime);
				const end = new Date(entry.endTime);
				if (end <= start) {
					new Notice(this.translate("modals.timeEntryEditor.validation.endBeforeStart"));
					return;
				}
			}
		}

		const sanitizedEntries = this.timeEntries.map((entry) => {
			const sanitizedEntry = { ...entry };
			delete sanitizedEntry.duration;
			return sanitizedEntry;
		});
		this.onSave(sanitizedEntries);
		this.close();
	}

	onClose() {
		if (this.keyboardHandler) {
			this.containerEl.removeEventListener("keydown", this.keyboardHandler);
			this.keyboardHandler = null;
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}

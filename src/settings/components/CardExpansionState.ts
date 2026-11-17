import { CARD_COLLAPSE_CHANGED, setCardCollapsed } from "./CardComponent";

const CARD_SELECTOR = ".tasknotes-settings__card[data-card-id]";

/** Session-only navigation state, independent of settings data and rendered elements. */
export class CardExpansionState {
	private readonly collapsed = new Map<string, boolean>();

	bind(container: HTMLElement, tabId: string): void {
		container.addEventListener(CARD_COLLAPSE_CHANGED, (event) => {
			const card = event.target as HTMLElement;
			if (!card.matches(CARD_SELECTOR)) return;
			this.collapsed.set(
				this.key(card, container, tabId),
				card.classList.contains("tasknotes-settings__card--collapsed")
			);
		});
	}

	restore(container: HTMLElement, tabId: string): void {
		container.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((card) => {
			const collapsed = this.collapsed.get(this.key(card, container, tabId));
			if (collapsed !== undefined) setCardCollapsed(card, collapsed);
		});
	}

	private key(card: HTMLElement, container: HTMLElement, tabId: string): string {
		const path: string[] = [];
		let current: HTMLElement | null = card;
		while (current && current !== container && container.contains(current)) {
			if (current.matches(CARD_SELECTOR)) path.unshift(current.dataset.cardId ?? "");
			current = current.parentElement;
		}
		return JSON.stringify([tabId, ...path]);
	}
}

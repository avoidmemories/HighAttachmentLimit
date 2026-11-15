const STYLE_ID = "high-attachment-limit-progress-style";
const ROOT_ID = "high-attachment-limit-progress";

const CSS = `
#${ROOT_ID} {
	position: fixed;
	right: 16px;
	bottom: 16px;
	z-index: 10000;
	display: flex;
	flex-direction: column;
	gap: 8px;
	width: 340px;
	padding: 12px 16px;
	border-radius: 8px;
	background: var(--hal-background);
	color: var(--hal-text);
	box-shadow: var(--elevation-high, 0 8px 16px rgba(0, 0, 0, 0.4));
	font-size: 14px;
	line-height: 1.4;
}
/* Discord's theme variables track the active theme; the class rules are fallbacks for builds that do not define them. */
#${ROOT_ID} {
	--hal-background: var(--background-floating, var(--background-base-lower, #2b2d31));
	--hal-text: var(--text-normal, #dbdee1);
}
.theme-light #${ROOT_ID} {
	--hal-background: var(--background-floating, var(--background-base-lower, #ffffff));
	--hal-text: var(--text-normal, #2e3338);
}
.theme-dark #${ROOT_ID} {
	--hal-background: var(--background-floating, var(--background-base-lower, #2b2d31));
	--hal-text: var(--text-normal, #dbdee1);
}
#${ROOT_ID} .hal-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}
#${ROOT_ID} .hal-title {
	font-weight: 600;
}
#${ROOT_ID} .hal-percent {
	color: var(--text-muted, #949ba4);
	font-variant-numeric: tabular-nums;
}
#${ROOT_ID} .hal-detail {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--text-muted, #949ba4);
}
#${ROOT_ID} .hal-track {
	position: relative;
	height: 6px;
	border-radius: 3px;
	background: var(--background-modifier-accent, #4e5058);
	overflow: hidden;
}
#${ROOT_ID} .hal-fill {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	width: 0;
	background: var(--brand-500, #5865f2);
	transition: width 0.2s ease;
}
#${ROOT_ID} .hal-track[data-indeterminate="true"] .hal-fill {
	width: 35%;
	animation: hal-slide 1.2s ease-in-out infinite;
}
#${ROOT_ID} .hal-cancel {
	align-self: flex-end;
	padding: 4px 12px;
	border: 0;
	border-radius: 4px;
	background: var(--button-danger-background, #da373c);
	color: var(--white, #ffffff);
	font-weight: 500;
	cursor: pointer;
}
#${ROOT_ID} .hal-cancel:focus-visible {
	outline: 2px solid var(--brand-500, #5865f2);
	outline-offset: 2px;
}
@keyframes hal-slide {
	from { left: -35%; }
	to { left: 100%; }
}
`;

export interface ClipProgress {
	setStage(title: string, detail: string): void;
	/** Pass undefined when the conversion has no measurable progress yet. */
	setRatio(ratio: number | undefined): void;
	close(): void;
}

function injectStyles() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
}

function createElement(tag: string, className: string) {
	const element = document.createElement(tag);
	element.className = className;
	return element;
}

export function showClipProgress({ onCancel }: { onCancel: () => void }): ClipProgress {
	injectStyles();
	document.getElementById(ROOT_ID)?.remove();

	const root = document.createElement("div");
	root.id = ROOT_ID;
	root.setAttribute("role", "status");
	root.setAttribute("aria-live", "polite");

	const title = createElement("span", "hal-title");
	const percent = createElement("span", "hal-percent");
	const header = createElement("div", "hal-header");
	header.append(title, percent);

	const detail = createElement("div", "hal-detail");

	const track = createElement("div", "hal-track");
	track.setAttribute("role", "progressbar");
	track.setAttribute("aria-label", "Clip conversion progress");
	track.setAttribute("aria-valuemin", "0");
	track.setAttribute("aria-valuemax", "100");
	const fill = createElement("div", "hal-fill");
	track.append(fill);

	const cancel = createElement("button", "hal-cancel") as HTMLButtonElement;
	cancel.type = "button";
	cancel.textContent = "Cancel";
	cancel.addEventListener("click", onCancel);

	root.append(header, detail, track, cancel);
	document.body.appendChild(root);

	return {
		setStage(nextTitle, nextDetail) {
			title.textContent = nextTitle;
			detail.textContent = nextDetail;
		},
		setRatio(ratio) {
			if (ratio === undefined) {
				track.dataset.indeterminate = "true";
				track.removeAttribute("aria-valuenow");
				fill.style.width = "";
				percent.textContent = "";
				return;
			}
			const value = Math.round(ratio * 100);
			track.dataset.indeterminate = "false";
			track.setAttribute("aria-valuenow", String(value));
			fill.style.width = `${value}%`;
			percent.textContent = `${value}%`;
		},
		close() {
			root.remove();
		},
	};
}

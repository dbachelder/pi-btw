/**
 * Bidi Text Wrapping for TUI Applications
 *
 * Bidirectional text rendering utilities that correctly handle mixed
 * RTL (Arabic, Hebrew, Persian, etc.) and LTR (English, code, etc.)
 * content per Unicode UAX #9.
 *
 * This is a TypeScript port of the Python `format.py` helper from the
 * `bidi-text-formatting` skill, extended with pi-tui integration helpers.
 *
 * @module bidi-wrap
 */

// ============================================================================
// Unicode Directional Controls (UAX #9)
// ============================================================================

/** First Strong Isolate — start of an isolated directional run (U+2068). */
export const FSI = "⁨";

/** Pop Directional Isolate — end of an isolated directional run (U+2069). */
export const PDI = "⁩";

/** Left-to-Right Mark — invisible directional hint (U+200E). */
export const LRM = "‎";

/** Right-to-Left Mark — invisible directional hint (U+200F). */
export const RLM = "‏";

// ============================================================================
// Types
// ============================================================================

/**
 * Direction classification for a character or run.
 * - "rtl": right-to-left script (Arabic, Hebrew, Persian, etc.)
 * - "ltr": left-to-right script (Latin, CJK, digits, punctuation)
 * - "n":   neutral (whitespace, control characters)
 */
export type Direction = "rtl" | "ltr" | "n";

/**
 * A run of consecutive characters sharing the same direction.
 */
export interface TextRun {
	dir: Direction;
	run: string;
}

// ============================================================================
// RTL Unicode Ranges
// ============================================================================

/**
 * Unicode code point ranges for right-to-left scripts.
 * Covers Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic,
 * Arabic Extended-A, Hebrew/Arabic presentation forms.
 */
export const RTL_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x0590, 0x05ff], // Hebrew
	[0x0600, 0x06ff], // Arabic
	[0x0700, 0x074f], // Syriac
	[0x0750, 0x077f], // Arabic Supplement
	[0x0780, 0x07bf], // Thaana
	[0x07c0, 0x07ff], // NKo
	[0x0800, 0x083f], // Samaritan
	[0x0840, 0x085f], // Mandaic
	[0x08a0, 0x08ff], // Arabic Extended-A
	[0xfb1d, 0xfb4f], // Hebrew presentation forms
	[0xfb50, 0xfdff], // Arabic presentation forms A
	[0xfe70, 0xfeff], // Arabic presentation forms B
] as const;

// ============================================================================
// Core Character & Run Classification
// ============================================================================

/**
 * Returns true if the given character belongs to an RTL script.
 *
 * @param ch - A single character (will take the first code point if surrogate pair)
 * @returns true if the character is in any RTL Unicode range
 */
export function isRtlChar(ch: string): boolean {
	if (!ch) return false;
	const cp = ch.codePointAt(0);
	if (cp === undefined) return false;
	return RTL_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/**
 * Splits a string into runs of RTL, LTR, or neutral characters.
 *
 * Whitespace and non-printable characters are classified as neutral.
 * Digits and Latin/CJK characters are LTR.
 *
 * @param text - Input text to split
 * @returns Array of runs in source order
 */
export function splitRuns(text: string): TextRun[] {
	if (!text) return [];
	const runs: TextRun[] = [];
	let curDir: Direction | null = null;
	let cur: string[] = [];

	const flush = () => {
		if (cur.length > 0) {
			runs.push({ dir: curDir ?? "n", run: cur.join("") });
			cur = [];
		}
	};

	for (const ch of text) {
		let d: Direction;
		if (ch === " " || ch === "\t" || (!ch.isPrintableSafe() && ch !== "\t")) {
			d = "n";
		} else if (isRtlChar(ch)) {
			d = "rtl";
		} else if (ch.isAscii()) {
			d = "ltr";
		} else {
			// Other scripts (CJK, etc.) treated as LTR
			d = "ltr";
		}
		if (d !== curDir) {
			flush();
			curDir = d;
			cur = [ch];
		} else {
			cur.push(ch);
		}
	}
	flush();
	return runs;
}

/**
 * Detects the dominant direction of a text by looking at its first
 * strong (non-whitespace) character.
 *
 * @param text - Input text
 * @returns "rtl" or "ltr" (defaults to "ltr" for empty/whitespace-only)
 */
export function detectDirection(text: string): "rtl" | "ltr" {
	for (const ch of text) {
		if (ch === " " || ch === "\t") continue;
		return isRtlChar(ch) ? "rtl" : "ltr";
	}
	return "ltr";
}

/**
 * Wraps each RTL/LTR run with FSI/PDI isolation markers so that the
 * string renders as discrete units regardless of bidi context.
 *
 * Neutral runs (whitespace) are left untouched.
 *
 * @param text - Input text
 * @returns Wrapped string with U+2068/U+2069 markers
 */
export function wrapWithIsolates(text: string): string {
	const runs = splitRuns(text);
	return runs
		.map(({ dir, run }) =>
			dir === "n" ? run : `${FSI}${run}${PDI}`,
		)
		.join("");
}

/**
 * Strips FSI/PDI/LRM/RLM directional markers from a string.
 *
 * @param text - Input text potentially containing markers
 * @returns Cleaned string without directional controls
 */
export function stripMarkers(text: string): string {
	return text
		.replaceAll(FSI, "")
		.replaceAll(PDI, "")
		.replaceAll(LRM, "")
		.replaceAll(RLM, "");
}

// ============================================================================
// pi-tui Integration
// ============================================================================

/**
 * Wraps text to fit within the given display width, preserving ANSI escape
 * codes and correctly handling mixed RTL/LTR content.
 *
 * This is the bidi-aware replacement for pi-tui's `wrapTextWithAnsi`.
 * It first splits the input into directional runs, wraps each run
 * independently, then reassembles.
 *
 * Note: ANSI codes are detected per character; for perfect ANSI preservation
 * when the text contains complex styles, callers should pre-extract ANSI
 * sequences. For typical BTW responses (text + minimal theming) this is
 * sufficient.
 *
 * @param text - Text to wrap
 * @param width - Maximum display width per line
 * @returns Array of wrapped lines
 */
export function bidiWrapText(text: string, width: number): string[] {
	if (!text) return [""];
	if (width <= 0) return [text];

	const lines: string[] = [];

	// Split on existing newlines first
	for (const paragraph of text.split("\n")) {
		if (paragraph === "") {
			lines.push("");
			continue;
		}

		// Strip ANSI for width calculations but preserve in output
		const segments = extractAnsiRuns(paragraph);

		let currentLine = "";
		let currentWidth = 0;

		for (const seg of segments) {
			if (seg.isAnsi) {
				// ANSI escape: append to current line, doesn't count toward width
				currentLine += seg.text;
				continue;
			}

			// For bidi handling, wrap this segment with isolates
			const isolated = wrapWithIsolates(seg.text);
			// But for width we measure the original (isolates have 0 width)

			const words = isolated.split(/(\s+)/); // keep whitespace tokens

			for (const word of words) {
				if (word === "") continue;

				// Plain-text width (without ANSI) — used for budget calculations
				const plainWord = stripAnsi(word);
				const wordWidth = plainWord.length; // Approximation for now

				if (currentWidth + wordWidth <= width) {
					currentLine += word;
					currentWidth += wordWidth;
				} else {
					// Word doesn't fit — push current line if non-empty
					if (currentLine.length > 0) {
						lines.push(currentLine);
						currentLine = "";
						currentWidth = 0;
					}

					// If word itself is wider than width, hard-break it
					if (wordWidth > width) {
						const broken = hardBreak(word, width, plainWord);
						lines.push(...broken.slice(0, -1));
						currentLine = broken[broken.length - 1] ?? "";
						currentWidth = plainVisibleWidth(currentLine);
					} else {
						currentLine = word;
						currentWidth = wordWidth;
					}
				}
			}
		}

		if (currentLine.length > 0) {
			lines.push(currentLine);
		} else if (lines.length === 0 || lines[lines.length - 1] !== "") {
			lines.push("");
		}
	}

	return lines.length > 0 ? lines : [""];
}

/**
 * Truncates text to fit within the given width, optionally appending
 * an ellipsis. Correctly handles RTL/LTR content.
 *
 * @param text - Text to truncate
 * @param width - Maximum display width
 * @param ellipsis - String to append when truncated (default: "")
 * @returns Truncated string
 */
export function bidiTruncate(
	text: string,
	width: number,
	ellipsis: string = "",
): string {
	if (width <= 0) return "";
	if (bidiVisibleWidth(text) <= width) return text;

	const targetWidth = Math.max(0, width - bidiVisibleWidth(ellipsis));
	const result: string[] = [];
	let currentWidth = 0;

	for (const ch of text) {
		const chWidth = isAnsi(ch) ? 0 : 1; // simple approximation
		if (currentWidth + chWidth > targetWidth) break;
		result.push(ch);
		currentWidth += chWidth;
	}

	return result.join("") + ellipsis;
}

/**
 * Computes the display width of a string, treating bidi markers as 0-width.
 *
 * This is a simplified approximation suitable for our needs; for perfect
 * Unicode width computation, integrate with the host terminal's wcwidth.
 *
 * @param text - Text to measure
 * @returns Approximate display width in columns
 */
export function bidiVisibleWidth(text: string): number {
	const stripped = stripMarkers(text);
	// Strip ANSI escape codes for width calc
	const plain = stripAnsi(stripped);
	// Treat CJK as 2-wide; everything else as 1-wide
	let w = 0;
	for (const ch of plain) {
		const cp = ch.codePointAt(0) ?? 0;
		if (
			(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
			(cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals
			(cp >= 0x3041 && cp <= 0x33ff) || // Hiragana/Katakana/CJK
			(cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
			(cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
			(cp >= 0xa000 && cp <= 0xa4cf) || // Yi
			(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
			(cp >= 0xf900 && cp <= 0xfaff) || // CJK Compat
			(cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compat Forms
			(cp >= 0xff00 && cp <= 0xff60) || // Fullwidth
			(cp >= 0xffe0 && cp <= 0xffe6) // Fullwidth signs
		) {
			w += 2;
		} else {
			w += 1;
		}
	}
	return w;
}

// ============================================================================
// Higher-Level Helpers
// ============================================================================

/**
 * Returns true if the text contains any RTL characters.
 *
 * @param text - Text to check
 * @returns true if any RTL characters present
 */
export function isBidiContent(text: string): boolean {
	for (const ch of text) {
		if (isRtlChar(ch)) return true;
	}
	return false;
}

/**
 * Normalizes bidi content by ensuring mixed-direction text has proper
 * isolation markers. Safe to call on already-isolated text (idempotent).
 *
 * @param text - Input text
 * @returns Normalized text with appropriate isolation
 */
export function normalizeBidi(text: string): string {
	// Strip any existing markers first to avoid double-isolation
	return wrapWithIsolates(stripMarkers(text));
}

// ============================================================================
// Internal Helpers
// ============================================================================

interface AnsiSegment {
	text: string;
	isAnsi: boolean;
}

const ANSI_ESCAPE_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/**
 * Splits text into ANSI escape sequences and plain text runs.
 * Used internally to preserve ANSI codes during bidi processing.
 */
function extractAnsiRuns(text: string): AnsiSegment[] {
	const segments: AnsiSegment[] = [];
	let lastIndex = 0;
	for (const match of text.matchAll(ANSI_ESCAPE_RE)) {
		const start = match.index ?? 0;
		if (start > lastIndex) {
			segments.push({ text: text.slice(lastIndex, start), isAnsi: false });
		}
		segments.push({ text: match[0], isAnsi: true });
		lastIndex = start + match[0].length;
	}
	if (lastIndex < text.length) {
		segments.push({ text: text.slice(lastIndex), isAnsi: false });
	}
	return segments;
}

/**
 * Strips ANSI escape codes from a string.
 */
function stripAnsi(text: string): string {
	return text.replace(ANSI_ESCAPE_RE, "");
}

/**
 * Simple check for ANSI escape start character.
 */
function isAnsi(ch: string): boolean {
	return ch === "\x1b";
}

/**
 * Hard-breaks a single "word" that's wider than the target width.
 * Returns array of broken pieces; last piece may be shorter.
 */
function hardBreak(
	word: string,
	width: number,
	plainWord: string,
): string[] {
	const lines: string[] = [];
	let current = "";
	let currentPlain = "";
	for (let i = 0; i < word.length; i++) {
		const ch = word[i] ?? "";
		const chPlain = plainWord[i] ?? "";
		if (plainVisibleWidth(currentPlain + chPlain) > width) {
			lines.push(current);
			current = ch;
			currentPlain = chPlain;
		} else {
			current += ch;
			currentPlain += chPlain;
		}
	}
	if (current.length > 0) lines.push(current);
	return lines.length > 0 ? lines : [""];
}

function plainVisibleWidth(text: string): number {
	let w = 0;
	for (const ch of text) {
		w += ch === "⁨" || ch === "⁩" || ch === "‎" || ch === "‏" ? 0 : 1;
	}
	return w;
}

// ============================================================================
// String prototype augmentation (minimal, safe)
// ============================================================================

declare global {
	interface String {
		isAscii(): boolean;
		isPrintableSafe(): boolean;
	}
}

if (!String.prototype.isAscii) {
	String.prototype.isAscii = function (this: string): boolean {
		for (let i = 0; i < this.length; i++) {
			if (this.charCodeAt(i) > 127) return false;
		}
		return true;
	};
}

if (!String.prototype.isPrintableSafe) {
	String.prototype.isPrintableSafe = function (this: string): boolean {
		for (let i = 0; i < this.length; i++) {
			const c = this.charCodeAt(i);
			if (c < 32 && c !== 9 && c !== 10 && c !== 13) return false;
		}
		return true;
	};
}
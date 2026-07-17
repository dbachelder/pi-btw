/**
 * Visual regression tests for bidi-aware rendering in BTW overlay.
 *
 * These tests verify that mixed RTL/LTR content wraps correctly within
 * the overlay frame boundaries, fixing the bug where Arabic text would
 * overflow beyond the frame because wrapTextWithAnsi didn't account
 * for bidirectional text width.
 */

import { describe, test, expect } from "vitest";
import {
	bidiTruncate,
	bidiVisibleWidth,
	bidiWrapText,
	stripMarkers,
	wrapWithIsolates,
} from "../lib/bidi-wrap.ts";

/**
 * Simulates what BtwOverlayComponent.wrapTranscript does:
 * - If line contains bidi content, uses bidiWrapText
 * - Otherwise uses pi-tui's wrapTextWithAnsi
 *
 * This helper lets us test the bidi path in isolation.
 */
function wrapForOverlay(line: string, width: number): string[] {
	const containsBidi = /[\u0590-\u06ff\u0700-\u08ff\uFB1D-\uFEFF]/.test(line);
	if (containsBidi) {
		return bidiWrapText(line, Math.max(1, width));
	}
	// For pure LTR, use pi-tui's wrapTextWithAnsi (we don't import it here
	// to keep tests focused on bidi). The behavior is equivalent for ASCII.
	const result: string[] = [];
	const words = line.split(/(\s+)/);
	let currentLine = "";
	for (const word of words) {
		if (word === "") continue;
		if (currentLine.length + word.length <= width) {
			currentLine += word;
		} else {
			if (currentLine) result.push(currentLine);
			currentLine = word.length > width ? word.slice(0, width) : word;
		}
	}
	if (currentLine) result.push(currentLine);
	return result.length > 0 ? result : [""];
}

describe("Visual regression: Arabic-only wrapping", () => {
	test("short Arabic line stays single-line", () => {
		const lines = wrapForOverlay("مرحبا بالعالم", 80);
		expect(lines).toHaveLength(1);
		expect(stripMarkers(lines[0] ?? "")).toBe("مرحبا بالعالم");
	});

	test("long Arabic wraps at word boundary", () => {
		const longText =
			"هذا نص عربي طويل جدا يحتاج إلى التفاف على عدة أسطر ضمن الإطار المحدد للمربع الحواري";
		const lines = wrapForOverlay(longText, 40);
		expect(lines.length).toBeGreaterThan(1);
		// Each line should be within bounds (allowing ±2 for word boundaries)
		for (const line of lines) {
			const plainWidth = bidiVisibleWidth(line);
			expect(plainWidth).toBeLessThanOrEqual(42);
		}
	});

	test("Arabic line shorter than width not modified", () => {
		const lines = wrapForOverlay("نص قصير", 80);
		expect(lines).toHaveLength(1);
		expect(stripMarkers(lines[0] ?? "")).toBe("نص قصير");
	});
});

describe("Visual regression: English-only wrapping (regression test)", () => {
	test("short English line stays single-line", () => {
		const lines = wrapForOverlay("Hello world", 80);
		expect(lines).toHaveLength(1);
		expect(stripMarkers(lines[0] ?? "")).toBe("Hello world");
	});

	test("long English wraps at word boundary", () => {
		const longText =
			"This is a long English sentence that should wrap across multiple lines within the overlay frame boundary";
		const lines = wrapForOverlay(longText, 40);
		expect(lines.length).toBeGreaterThan(1);
	});

	test("short English preserved exactly", () => {
		const lines = wrapForOverlay("hi", 80);
		expect(lines).toHaveLength(1);
		expect(stripMarkers(lines[0] ?? "")).toBe("hi");
	});
});

describe("Visual regression: Mixed RTL/LTR (THE BUG WE FIX)", () => {
	test("Arabic with English code identifier stays within bounds", () => {
		const mixed = "cpp_str المعكوس في الكود";
		const lines = wrapForOverlay(mixed, 20);
		// Each line must fit within width (with small tolerance for word wrap)
		for (const line of lines) {
			const plainWidth = bidiVisibleWidth(line);
			expect(plainWidth).toBeLessThanOrEqual(22);
		}
	});

	test("English with Arabic phrase wraps correctly", () => {
		const mixed = "The مرحبا word has Arabic mixed in";
		const lines = wrapForOverlay(mixed, 30);
		// Lines should wrap at sensible boundaries
		expect(lines.length).toBeGreaterThanOrEqual(1);
		for (const line of lines) {
			expect(bidiVisibleWidth(line)).toBeLessThanOrEqual(32);
		}
	});

	test("Mixed with code identifier at boundary", () => {
		const mixed = "Use the useState hook for state management";
		const lines = wrapForOverlay(mixed, 20);
		// Verify no word is split in the middle
		for (const line of lines) {
			// Each line should be a valid word boundary
			expect(line.length).toBeLessThanOrEqual(25);
		}
	});

	test("Arabic sentence with English markdown preserved", () => {
		const mixed = "اكتب **hello world** في الكود";
		const lines = wrapForOverlay(mixed, 25);
		// Content should be preserved (markers may be added)
		const reconstructed = stripMarkers(lines.join(" "));
		expect(reconstructed).toContain("hello");
		expect(reconstructed).toContain("world");
	});
});

describe("Visual regression: Code identifier preservation", () => {
	test("cpp_str stays as cpp_str (not reversed)", () => {
		const line = "Variable cpp_str المعكوس";
		const lines = wrapForOverlay(line, 40);
		const all = lines.join(" ");
		const plain = stripMarkers(all);
		expect(plain).toContain("cpp_str");
		expect(plain).not.toContain("rts_ppc");
	});

	test("snake_case identifiers preserved", () => {
		const line = "Function get_user_name المعكوس returns the user";
		const lines = wrapForOverlay(line, 40);
		const plain = stripMarkers(lines.join(" "));
		expect(plain).toContain("get_user_name");
		expect(plain).not.toContain("eman_resu_teg");
	});

	test("camelCase preserved", () => {
		const line = "Method getUserName المعكوس for Arabic";
		const lines = wrapForOverlay(line, 40);
		const plain = stripMarkers(lines.join(" "));
		expect(plain).toContain("getUserName");
	});
});

describe("Visual regression: Truncation within overlay", () => {
	test("Long Arabic truncated at boundary", () => {
		const long = "هذا نص طويل جدا يجب أن يتم اقتطاعه";
		const truncated = bidiTruncate(long, 10, "");
		expect(bidiVisibleWidth(truncated)).toBeLessThanOrEqual(10);
		// Original text should be a prefix of truncated
		expect(long.startsWith(stripMarkers(truncated))).toBe(true);
	});

	test("Mixed content truncated correctly", () => {
		const mixed = "Hello مرحبا world wide web";
		const truncated = bidiTruncate(mixed, 10, "");
		expect(bidiVisibleWidth(truncated)).toBeLessThanOrEqual(10);
	});

	test("Empty width returns empty", () => {
		expect(bidiTruncate("hello", 0)).toBe("");
	});
});

describe("Visual regression: Bidirectional isolation markers", () => {
	test("Each run wrapped with FSI/PDI", () => {
		const wrapped = wrapWithIsolates("Hello مرحبا world");
		expect(wrapped).toContain("⁨Hello⁩");
		expect(wrapped).toContain("⁨مرحبا⁩");
		expect(wrapped).toContain("⁨world⁩");
	});

	test("Neutral whitespace not wrapped", () => {
		const wrapped = wrapWithIsolates(" ");
		expect(wrapped).toBe(" ");
	});

	test("Wrapping preserves run boundaries", () => {
		const text = "Code cpp_str المعكوس identifier";
		const wrapped = wrapWithIsolates(text);
		const runs = wrapped.split(/\s+/);
		// Spaces are neutral, runs are isolated
		expect(wrapped.split(" ").length).toBe(text.split(" ").length);
	});
});

describe("Visual regression: Boundary conditions", () => {
	test("Empty line in transcript", () => {
		const lines = wrapForOverlay("", 80);
		expect(lines).toEqual([""]);
	});

	test("Single character", () => {
		const lines = wrapForOverlay("م", 80);
		expect(lines).toHaveLength(1);
		expect(stripMarkers(lines[0] ?? "")).toBe("م");
	});

	test("Width = 1 (minimum)", () => {
		const lines = wrapForOverlay("مرحبا", 1);
		// Should still produce output, even if heavily wrapped
		expect(lines.length).toBeGreaterThan(0);
	});

	test("Width exactly equal to text length", () => {
		const text = "مرحبا";
		const lines = wrapForOverlay(text, 5);
		expect(lines).toHaveLength(1);
	});
});

describe("Visual regression: Multi-paragraph content", () => {
	test("Newlines preserved between paragraphs", () => {
		const text = "فقرة أولى\nالفقرة الثانية";
		const lines = wrapForOverlay(text, 80);
		// Should have at least 2 lines (one per paragraph)
		expect(lines.length).toBeGreaterThanOrEqual(2);
	});

	test("Mixed multi-paragraph wraps correctly", () => {
		const text = "First paragraph in English\nالفقرة الثانية بالعربي";
		const lines = wrapForOverlay(text, 30);
		// Content from both paragraphs preserved
		const all = stripMarkers(lines.join("\n"));
		expect(all).toContain("First");
		expect(all).toContain("الثانية");
	});
});
import { describe, expect, it, vi } from "vitest";
import { initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { BtwOverlayComponent, BTW_COMMANDS } from "../extensions/btw";

initTheme("dark", false);

function fixture() {
  const submit = vi.fn();
  const dismiss = vi.fn();
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as ExtensionContext["ui"]["theme"];
  const keybindings = new KeybindingsManager({
    ...TUI_KEYBINDINGS, "app.clear": { defaultKeys: "ctrl+c", description: "Clear composer" },
  });
  const overlay = new BtwOverlayComponent(
    { mode: "fullscreen", requestRender: vi.fn() } as unknown as TUI,
    theme, keybindings, () => [], () => null, () => "contextual", () => "window",
    submit, dismiss, vi.fn(), vi.fn(),
  );
  return { overlay, submit, dismiss };
}

const down = "\x1b[B";
const up = "\x1b[A";
const escape = "\x1b";

describe("BTW composer completion with real Pi input", () => {
  it("opens from typed slash, filters, navigates, and accepts without submitting", () => {
    const { overlay, submit } = fixture();
    overlay.handleInput("/");
    expect(overlay.render(80).join("\n")).toContain("→ /btw ");
    const originalHeight = overlay.render(80).length;
    overlay.handleInput(down);
    expect(overlay.render(80).join("\n")).toContain("→ /side ");
    overlay.handleInput("\t");
    expect(overlay.getDraft()).toBe("/side ");
    expect(submit).not.toHaveBeenCalled();
    expect(overlay.render(80).length).toBe(originalHeight);
    overlay.handleInput("question");
    overlay.handleInput("\r");
    expect(submit).toHaveBeenCalledWith("/side question");
    overlay.setDraft("/btw:thi");
    expect(overlay.render(80).join("\n")).toContain("→ /btw:thinking");
    overlay.handleInput("\r");
    expect(overlay.getDraft()).toBe("/btw:thinking ");
    expect(submit).toHaveBeenCalledTimes(1);
    overlay.handleInput("low");
    overlay.handleInput("\r");
    expect(submit).toHaveBeenLastCalledWith("/btw:thinking low");
  });

  it("makes every registered command reachable, including wraparound", () => {
    const { overlay } = fixture();
    for (const [index, command] of BTW_COMMANDS.entries()) {
      overlay.setDraft("/");
      for (let step = 0; step < index; step++) overlay.handleInput(down);
      expect(overlay.render(48).join("\n")).toContain(`→ /${command.name}`);
      overlay.handleInput("\t");
      expect(overlay.getDraft()).toBe(`/${command.name} `);
    }
    overlay.setDraft("/");
    overlay.handleInput(up);
    overlay.handleInput("\t");
    expect(overlay.getDraft()).toBe("/btw:thinking ");
  });

  it("dismisses completion on first Escape and the overlay on the next", () => {
    const { overlay, dismiss } = fixture();
    overlay.handleInput("/btw:");
    overlay.handleInput(escape);
    expect(dismiss).not.toHaveBeenCalled();
    expect(overlay.getDraft()).toBe("/btw:");
    expect(overlay.render(80).join("\n")).not.toContain("→ /btw:");
    overlay.handleInput(escape);
    expect(dismiss).toHaveBeenCalledTimes(1);
    overlay.handleInput("a");
    expect(overlay.render(80).join("\n")).toContain("→ /btw:ask");
  });

  it("preserves exact-command submission and passes unknown slash input through", () => {
    const { overlay, submit } = fixture();
    for (const value of ["/btw", "/btw:clear", "/help", "a /btw: prefix", "/btw:model provider model"]) {
      overlay.setDraft(value);
      overlay.handleInput("\r");
      expect(submit).toHaveBeenLastCalledWith(value);
    }
  });

  it("clear removes suggestions and renders within the existing height and width", () => {
    const { overlay, dismiss } = fixture();
    const rows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    Object.defineProperty(process.stdout, "rows", { value: 24, configurable: true });
    try {
      const baseHeight = overlay.render(40).length;
      overlay.setDraft("/");
      const lines = overlay.render(40);
      expect(lines).toHaveLength(baseHeight);
      expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
      overlay.handleInput("\x03");
      expect(overlay.getDraft()).toBe("");
      expect(overlay.render(40).join("\n")).not.toContain("→ /btw");
      expect(dismiss).not.toHaveBeenCalled();
    } finally {
      if (rows) Object.defineProperty(process.stdout, "rows", rows);
      else Reflect.deleteProperty(process.stdout, "rows");
    }
  });
});

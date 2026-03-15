import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, RegisteredCommand } from "@mariozechner/pi-coding-agent";
import btwExtension from "../extensions/btw";

const { streamSimpleMock, completeSimpleMock } = vi.hoisted(() => ({
  streamSimpleMock: vi.fn(),
  completeSimpleMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-ai")>("@mariozechner/pi-ai");
  return {
    ...actual,
    streamSimple: streamSimpleMock,
    completeSimple: completeSimpleMock,
  };
});

type CustomEntry = { type: "custom"; customType: string; data?: unknown };
type SessionEntry = CustomEntry | { type: string; role?: string; customType?: string; content?: unknown; [key: string]: unknown };

type StreamContext = {
  systemPrompt: string;
  messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
};

class FakeOverlayHandle {
  hidden = false;
  focused = false;
  hideCalls = 0;
  setHidden(hidden: boolean) {
    this.hidden = hidden;
  }
  isHidden() {
    return this.hidden;
  }
  focus() {
    this.focused = true;
  }
  unfocus() {
    this.focused = false;
  }
  isFocused() {
    return this.focused;
  }
  hide() {
    this.hideCalls += 1;
    this.hidden = true;
    this.focused = false;
  }
}

const tuiMocks = vi.hoisted(() => {
  class FakeInput {
    value = "";
    focused = false;
    onSubmit?: (value: string) => void;
    onEscape?: () => void;
    setValue(value: string) {
      this.value = value;
    }
    getValue() {
      return this.value;
    }
    render(_width: number) {
      return [`> ${this.value}`];
    }
    handleInput(_data: string) {}
  }

  class FakeContainer {
    children: unknown[] = [];
    addChild(child: unknown) {
      this.children.push(child);
    }
    clear() {
      this.children = [];
    }
  }

  class FakeText {
    constructor(public text: string) {}
    setText(text: string) {
      this.text = text;
    }
  }

  class FakeSpacer {}
  class FakeBox extends FakeContainer {}

  return { FakeInput, FakeContainer, FakeText, FakeSpacer, FakeBox };
});

vi.mock("@mariozechner/pi-tui", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-tui")>("@mariozechner/pi-tui");
  return {
    ...actual,
    Container: tuiMocks.FakeContainer,
    Text: tuiMocks.FakeText,
    Input: tuiMocks.FakeInput,
    Spacer: tuiMocks.FakeSpacer,
    Box: tuiMocks.FakeBox,
  };
});

function makeAssistantMessage(answer: string) {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text: answer }],
    provider: "test-provider",
    model: "test-model",
    api: "openai-responses" as const,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

async function* streamAnswer(answer: string) {
  yield { type: "text_delta" as const, delta: answer.slice(0, Math.max(1, Math.floor(answer.length / 2))) };
  yield { type: "text_delta" as const, delta: answer.slice(Math.max(1, Math.floor(answer.length / 2))) };
  yield { type: "done" as const, message: makeAssistantMessage(answer) };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getCustomEntries(entries: SessionEntry[], customType: string): CustomEntry[] {
  return entries.filter((entry): entry is CustomEntry => entry.type === "custom" && entry.customType === customType);
}

function transcriptText(overlay: any): string {
  overlay.refresh();
  return overlay.transcript.children.map((child: any) => child.text).join("\n");
}

function findLatest<T>(items: T[], predicate: (item: T) => boolean): T {
  const match = [...items].reverse().find(predicate);
  if (!match) throw new Error("Expected matching item");
  return match;
}

function createHarness(
  initialEntries: SessionEntry[] = [],
  options: {
    theme?: {
      fg: (name: string, text: string) => string;
      bg: (name: string, text: string) => string;
      italic: (text: string) => string;
      bold: (text: string) => string;
    };
  } = {},
) {
  const commands = new Map<string, RegisteredCommand>();
  const handlers = new Map<string, Function[]>();
  const entries: SessionEntry[] = [...initialEntries];
  const notifications: Array<{ message: string; type?: string }> = [];
  const widgets: Array<{ key: string; content?: unknown; options?: unknown }> = [];
  const sentMessages: Array<{ message: unknown; options?: unknown }> = [];
  const sentUserMessages: Array<{ content: unknown; options?: unknown }> = [];
  const overlayHandles: FakeOverlayHandle[] = [];
  const overlays: Array<{ factoryOptions?: unknown; done?: (result: unknown) => void; component?: any }> = [];
  const tui = { requestRender: vi.fn() };
  const theme = options.theme ?? {
    fg: (_name: string, text: string) => text,
    bg: (_name: string, text: string) => text,
    italic: (text: string) => text,
    bold: (text: string) => text,
  };
  const keybindings = {
    matches: (_data: string, _id: string) => false,
  };

  const sessionManager = {
    getEntries: () => entries,
    getLeafId: () => "leaf",
    getBranch: () => entries,
  };

  const model = { provider: "test-provider", id: "test-model", api: "openai-responses" };
  let idle = true;
  let hasCredentials = true;

  const ui = {
    theme,
    notify: (message: string, type?: "info" | "warning" | "error") => {
      notifications.push({ message, type });
    },
    setWidget: (key: string, content: unknown, options?: unknown) => {
      widgets.push({ key, content, options });
    },
    custom: async (factory: any, options?: any) => {
      let done!: (result: unknown) => void;
      const resultPromise = new Promise((resolve) => {
        done = (result: unknown) => resolve(result);
      });
      const handle = new FakeOverlayHandle();
      overlayHandles.push(handle);
      options?.onHandle?.(handle);
      const component = await factory(tui as any, theme as any, keybindings as any, done);
      overlays.push({ factoryOptions: options, done, component });
      return resultPromise;
    },
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: async () => undefined,
    setEditorComponent: () => {},
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: true }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
  };

  const api: ExtensionAPI = {
    on: ((event: string, handler: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }) as any,
    registerTool: vi.fn() as any,
    registerCommand: ((name: string, options: any) => {
      commands.set(name, { name, ...options } as RegisteredCommand);
    }) as any,
    registerShortcut: vi.fn() as any,
    registerFlag: vi.fn() as any,
    getFlag: vi.fn() as any,
    registerMessageRenderer: vi.fn() as any,
    sendMessage: ((message: unknown, options?: unknown) => sentMessages.push({ message, options })) as any,
    sendUserMessage: ((content: unknown, options?: unknown) => sentUserMessages.push({ content, options })) as any,
    appendEntry: ((customType: string, data?: unknown) => entries.push({ type: "custom", customType, data })) as any,
    setSessionName: vi.fn() as any,
    getSessionName: vi.fn() as any,
    setLabel: vi.fn() as any,
    exec: vi.fn() as any,
    getActiveTools: vi.fn(() => []) as any,
    getAllTools: vi.fn(() => []) as any,
    setActiveTools: vi.fn() as any,
    getCommands: vi.fn(() => Array.from(commands.values())) as any,
    setModel: vi.fn(async () => true) as any,
    getThinkingLevel: vi.fn(() => "off") as any,
    setThinkingLevel: vi.fn() as any,
    registerProvider: vi.fn() as any,
  } as unknown as ExtensionAPI;

  btwExtension(api);

  const baseCtx = {
    hasUI: true,
    ui: ui as any,
    sessionManager: sessionManager as any,
    modelRegistry: {
      getApiKey: vi.fn(async () => (hasCredentials ? "test-key" : undefined)),
    },
    model,
    getSystemPrompt: () => "system",
    isIdle: () => idle,
  };

  async function runEvent(name: string, event: unknown = {}, ctx: ExtensionContext | ExtensionCommandContext = baseCtx as any) {
    const list = handlers.get(name) ?? [];
    const results = [];
    for (const handler of list) {
      results.push(await handler(event, ctx));
    }
    return results;
  }

  async function runSessionStart() {
    await runEvent("session_start");
  }

  async function command(name: string, args = "") {
    const cmd = commands.get(name);
    if (!cmd) throw new Error(`Missing command: ${name}`);
    await cmd.handler(args, baseCtx as unknown as ExtensionCommandContext);
  }

  function latestOverlayComponent() {
    const overlay = overlays.at(-1)?.component;
    if (!overlay) throw new Error("Overlay not created");
    return overlay;
  }

  function latestWidgetFactory() {
    const widget = [...widgets].reverse().find((entry) => entry.key === "btw" && typeof entry.content === "function");
    if (!widget) throw new Error("Widget not rendered");
    return widget.content as (tui: unknown, theme: typeof theme) => any;
  }

  return {
    api,
    entries,
    notifications,
    widgets,
    sentMessages,
    sentUserMessages,
    overlayHandles,
    overlays,
    baseCtx,
    runSessionStart,
    runEvent,
    command,
    latestOverlayComponent,
    latestWidgetFactory,
    setIdle(value: boolean) {
      idle = value;
    },
    setCredentials(value: boolean) {
      hasCredentials = value;
    },
  };
}

describe("btw runtime behavior", () => {
  beforeEach(() => {
    streamSimpleMock.mockReset();
    completeSimpleMock.mockReset();
    streamSimpleMock.mockImplementation((_model: unknown, context: StreamContext) => {
      return streamAnswer(`default:${(context.messages.at(-1)?.content[0] as any)?.text ?? ""}`);
    });
  });

  it("keeps the thread after Escape dismissal and restores it on reopen", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(1);
    expect(harness.overlayHandles).toHaveLength(1);

    const overlay = harness.latestOverlayComponent();
    overlay.input.onEscape?.();
    await flushAsyncWork();

    await harness.command("btw", "");
    expect(harness.overlayHandles).toHaveLength(2);

    const reopened = harness.latestOverlayComponent();
    const transcript = transcriptText(reopened);
    expect(transcript).toContain("You  first question");
    expect(transcript).toContain("Assistant");
    expect(transcript).toContain("First answer");
    expect(reopened.statusText.text).toContain("Ready for a follow-up");
  });

  it("supports an in-place follow-up and preserves both turns in one thread", async () => {
    const harness = createHarness();
    streamSimpleMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("follow-up question");
    await flushAsyncWork();

    const threadEntries = getCustomEntries(harness.entries, "btw-thread-entry");
    expect(threadEntries).toHaveLength(2);

    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  first question");
    expect(transcript).toContain("First answer");
    expect(transcript).toContain("You  follow-up question");
    expect(transcript).toContain("Second answer");
    expect(overlay.statusText.text).toContain("Ready for a follow-up");
  });

  it("clears the modal composer after a follow-up is submitted", async () => {
    const harness = createHarness();
    streamSimpleMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.setValue("follow-up question");
    overlay.input.onSubmit?.("follow-up question");
    await flushAsyncWork();

    expect(overlay.getDraft()).toBe("");
  });

  it("applies distinct theme treatment to user and assistant transcript rows", async () => {
    const harness = createHarness([], {
      theme: {
        fg: (name: string, text: string) => `<fg:${name}>${text}</fg:${name}>`,
        bg: (name: string, text: string) => `<bg:${name}>${text}</bg:${name}>`,
        italic: (text: string) => `<italic>${text}</italic>`,
        bold: (text: string) => `<bold>${text}</bold>`,
      },
    });
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const transcript = transcriptText(harness.latestOverlayComponent());
    expect(transcript).toContain("<bg:userMessageBg>");
    expect(transcript).toContain("<fg:accent>");
    expect(transcript).toContain("<bg:customMessageBg>");
    expect(transcript).toContain("<fg:success>");
  });

  it("surfaces missing credentials as an explicit error without creating a thread entry", async () => {
    const harness = createHarness();
    harness.setCredentials(false);

    await harness.runSessionStart();
    await harness.command("btw", "why did this fail?");

    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(0);
    const overlay = harness.latestOverlayComponent();
    overlay.refresh();
    expect(overlay.statusText.text).toContain("No credentials available for test-provider/test-model.");
    expect(harness.notifications.at(-1)).toEqual({
      message: "No credentials available for test-provider/test-model.",
      type: "error",
    });
  });

  it("keeps BTW in an overlay and does not leave a persistent widget above the main input", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("Overlay answer"));

    await harness.runSessionStart();
    await harness.command("btw", "overlay question");

    expect(harness.overlays.at(-1)?.factoryOptions).toMatchObject({ overlay: true });
    expect(harness.widgets.some((entry) => entry.key === "btw" && typeof entry.content === "function")).toBe(false);
  });

  it("forwards terminal input from the focused overlay to the embedded BTW input", async () => {
    const harness = createHarness();

    await harness.runSessionStart();
    await harness.command("btw", "");

    const overlay = harness.latestOverlayComponent();
    const inputHandleSpy = vi.spyOn(overlay.input, "handleInput");

    overlay.handleInput("abc");

    expect(inputHandleSpy).toHaveBeenCalledWith("abc");
  });

  it("renders BTW as a bordered fixed-height dialog with an internal transcript viewport", async () => {
    const harness = createHarness();
    const longAnswer = Array.from({ length: 24 }, (_, index) => `line ${index + 1} of a long answer`).join("\n");

    streamSimpleMock
      .mockImplementationOnce(() => streamAnswer(longAnswer))
      .mockImplementationOnce(() => streamAnswer(longAnswer));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    const firstRender = overlay.render(80);

    overlay.input.onSubmit?.("second question");
    await flushAsyncWork();

    const secondRender = overlay.render(80);

    expect(firstRender[0]).toContain("┌");
    expect(firstRender.at(-1)).toContain("└");
    expect(secondRender[0]).toContain("┌");
    expect(secondRender.at(-1)).toContain("└");
    expect(firstRender.length).toBe(secondRender.length);
  });

  it("/btw:new appends a reset marker, clears prior hidden thread state, stays contextual, and reopens a fresh thread", async () => {
    const harness = createHarness();
    streamSimpleMock
      .mockImplementationOnce((_model: unknown, context: StreamContext) => {
        expect(context.messages.map((message) => (message.content[0] as any)?.text ?? "")).toContain("first question");
        return streamAnswer("First answer");
      })
      .mockImplementationOnce((_model: unknown, context: StreamContext) => {
        const texts = context.messages.map((message) => (message.content[0] as any)?.text ?? "");
        expect(texts).not.toContain("first question");
        expect(texts).not.toContain("First answer");
        expect(texts).toContain("replacement question");
        return streamAnswer("Replacement answer");
      });

    await harness.runSessionStart();
    await harness.command("btw", "first question");
    await harness.command("btw:new", "replacement question");

    const postResetOverlay = harness.latestOverlayComponent();
    const postResetTranscript = transcriptText(postResetOverlay);
    expect(postResetTranscript).not.toContain("You  first question");
    expect(postResetTranscript).not.toContain("First answer");
    expect(postResetTranscript).toContain("You  replacement question");
    expect(postResetTranscript).toContain("Replacement answer");

    await harness.command("btw:new", "");

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(2);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "contextual" });

    const threadEntries = getCustomEntries(harness.entries, "btw-thread-entry");
    expect(threadEntries).toHaveLength(2);

    const overlay = harness.latestOverlayComponent();
    const transcript = transcriptText(overlay);
    expect(transcript).toContain("No BTW thread yet. Ask a side question to start one.");
    expect(overlay.statusText.text).toContain("Started a fresh BTW thread.");
  });

  it("switching between /btw:tangent and /btw appends reset markers and tangent requests omit inherited main-session conversation", async () => {
    const mainVisibleNote = {
      type: "custom",
      role: "custom",
      customType: "btw-note",
      content: "saved btw note",
    } as SessionEntry;
    const mainRegularUser = {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "main session task" }],
      timestamp: Date.now(),
    } as SessionEntry;
    const harness = createHarness([mainVisibleNote, mainRegularUser]);

    await harness.runSessionStart();
    await harness.command("btw", "contextual start");
    await harness.command("btw:tangent", "tangent start");
    await harness.command("btw", "contextual again");

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(2);
    expect(resets.map((entry) => (entry.data as any)?.mode)).toEqual(["tangent", "contextual"]);

    const streamCalls = streamSimpleMock.mock.calls as Array<[unknown, StreamContext, unknown]>;
    expect(streamCalls.length).toBeGreaterThanOrEqual(2);

    const callTexts = streamCalls.map((call) => call[1].messages.map((message) => (message.content[0] as any)?.text ?? ""));
    const tangentTexts = callTexts.find((texts) => texts.at(-1) === "tangent start");
    expect(tangentTexts).toBeDefined();
    expect(tangentTexts).not.toContain("main session task");
    expect(tangentTexts).not.toContain("saved btw note");

    const contextualTexts = callTexts.find((texts) => texts.at(-1) === "contextual start");
    if (contextualTexts) {
      expect(contextualTexts).not.toContain("saved btw note");
    }

    const overlay = harness.latestOverlayComponent();
    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  contextual again");
    expect(transcript).toContain("default:contextual again");
    expect(transcript).not.toContain("You  tangent start");
    expect(transcript).not.toContain("default:tangent start");
  });

  it("/btw:clear dismisses the overlay, appends a reset marker, and restore only rehydrates entries after the last reset", async () => {
    const seedEntries: SessionEntry[] = [
      { type: "custom", customType: "btw-thread-entry", data: { question: "old q", thinking: "", answer: "old a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 1 } },
      { type: "custom", customType: "btw-thread-reset", data: { timestamp: 2, mode: "tangent" } },
      { type: "custom", customType: "btw-thread-entry", data: { question: "new q", thinking: "", answer: "new a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 3 } },
    ];
    const harness = createHarness(seedEntries);

    await harness.runEvent("session_start");
    await harness.command("btw", "");
    let overlay = harness.latestOverlayComponent();
    expect(transcriptText(overlay)).toContain("You  new q");
    expect(transcriptText(overlay)).not.toContain("You  old q");

    await harness.command("btw", "restore-visible");
    expect(harness.overlayHandles).toHaveLength(1);

    const resetCountBeforeClear = getCustomEntries(harness.entries, "btw-thread-reset").length;
    await harness.command("btw:clear", "");

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(resetCountBeforeClear + 1);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "contextual" });
    expect(harness.notifications.at(-1)).toEqual({ message: "Cleared BTW thread.", type: "info" });

    await harness.runEvent("session_switch");
    await harness.command("btw", "");
    overlay = harness.latestOverlayComponent();
    expect(transcriptText(overlay)).toContain("No BTW thread yet. Ask a side question to start one.");

    harness.entries.push({
      type: "custom",
      customType: "btw-thread-entry",
      data: { question: "post-clear q", thinking: "", answer: "post-clear a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 4 },
    });

    await harness.runEvent("session_tree");
    await harness.command("btw", "");
    overlay = harness.latestOverlayComponent();
    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  post-clear q");
    expect(transcript).toContain("post-clear a");
    expect(transcript).not.toContain("You  new q");
  });

  it("restore behavior is consistent across session_start, session_switch, and session_tree", async () => {
    const entries: SessionEntry[] = [
      { type: "custom", customType: "btw-thread-reset", data: { timestamp: 1, mode: "tangent" } },
      { type: "custom", customType: "btw-thread-entry", data: { question: "restored q", thinking: "", answer: "restored a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 2 } },
    ];

    for (const eventName of ["session_start", "session_switch", "session_tree"]) {
      const harness = createHarness(entries);
      await harness.runEvent(eventName);
      await harness.command("btw", "");
      const overlay = harness.latestOverlayComponent();
      const transcript = transcriptText(overlay);
      expect(transcript).toContain("You  restored q");
      expect(transcript).toContain("restored a");
      expect(overlay['modeText'].text).toContain("BTW tangent");
    }
  });

  it("/btw:inject success sends one main-session message, appends a reset marker, dismisses the overlay, and reopens fresh", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlayHandle = harness.overlayHandles.at(-1);
    expect(overlayHandle).toBeDefined();
    expect(overlayHandle?.isHidden()).toBe(false);

    await harness.command("btw:inject", "Use this as supporting context.");

    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content: "Here is a side conversation I had. Use this as supporting context.\n\nUser: first question\nAssistant: First answer",
      options: undefined,
    });
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(1);
    expect(overlayHandle?.hideCalls).toBe(1);
    expect(harness.notifications.at(-1)).toEqual({
      message: "Injected BTW thread (1 exchange).",
      type: "info",
    });

    await harness.command("btw", "");
    const reopened = harness.latestOverlayComponent();
    expect(transcriptText(reopened)).toContain("No BTW thread yet. Ask a side question to start one.");
  });

  it("/btw:inject while the main session is busy delivers to the main session as a follow-up", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("Busy answer"));

    await harness.runSessionStart();
    await harness.command("btw", "busy question");
    harness.setIdle(false);

    await harness.command("btw:inject", "Queue this behind the active turn.");

    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content: "Here is a side conversation I had. Queue this behind the active turn.\n\nUser: busy question\nAssistant: Busy answer",
      options: { deliverAs: "followUp" },
    });
  });

  it("/btw:summarize success sends summary content, appends a reset marker, dismisses the overlay, and reopens fresh", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));
    completeSimpleMock.mockResolvedValue(makeAssistantMessage("Short summary"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlayHandle = harness.overlayHandles.at(-1);
    expect(overlayHandle).toBeDefined();

    await harness.command("btw:summarize", "Hand this to the main agent.");

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content: "Here is a summary of a side conversation I had. Hand this to the main agent.\n\nShort summary",
      options: undefined,
    });
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(1);
    expect(overlayHandle?.hideCalls).toBe(1);
    expect(harness.notifications.at(-1)).toEqual({
      message: "Injected BTW summary (1 exchange).",
      type: "info",
    });

    await harness.command("btw", "");
    const reopened = harness.latestOverlayComponent();
    expect(transcriptText(reopened)).toContain("No BTW thread yet. Ask a side question to start one.");
  });

  it("summarize failure preserves BTW thread state and keeps the overlay recoverable", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));
    completeSimpleMock.mockResolvedValue({
      ...makeAssistantMessage(""),
      stopReason: "error",
      errorMessage: "Summary model exploded",
    });

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlayHandle = harness.overlayHandles.at(-1);
    await harness.command("btw:summarize", "retry later");

    expect(harness.sentUserMessages).toHaveLength(0);
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(1);
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(0);
    expect(overlayHandle?.isHidden()).toBe(false);

    const overlay = harness.latestOverlayComponent();
    overlay.refresh();
    expect(overlay.statusText.text).toContain("Summarize failed. Thread preserved for retry or injection.");
    expect(transcriptText(overlay)).toContain("You  first question");
    expect(transcriptText(overlay)).toContain("First answer");
    expect(harness.notifications.at(-1)).toEqual({
      message: "Summary model exploded",
      type: "error",
    });
  });

  it("in-modal /btw:new reuses command semantics by resetting the thread and reopening contextual mode", async () => {
    const harness = createHarness();
    streamSimpleMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Replacement answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("/btw:new replacement question");
    await flushAsyncWork();

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(1);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "contextual" });

    const transcript = transcriptText(overlay);
    expect(transcript).not.toContain("You  first question");
    expect(transcript).not.toContain("First answer");
    expect(transcript).toContain("You  replacement question");
    expect(transcript).toContain("Replacement answer");
    expect(overlay['modeText'].text).toContain("BTW");
  });

  it("in-modal /btw:tangent reuses command semantics by switching modes and dropping inherited main-session context", async () => {
    const mainRegularUser = {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "main session task" }],
      timestamp: Date.now(),
    } as SessionEntry;
    const harness = createHarness([mainRegularUser]);

    await harness.runSessionStart();
    await harness.command("btw", "contextual start");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("/btw:tangent tangent start");
    await flushAsyncWork();

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(1);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "tangent" });

    const streamCalls = streamSimpleMock.mock.calls as Array<[unknown, StreamContext, unknown]>;
    const tangentCall = [...streamCalls].reverse().find((call) => {
      const texts = call[1].messages.map((message) => (message.content[0] as any)?.text ?? "");
      return texts.at(-1) === "tangent start";
    });
    expect(tangentCall).toBeDefined();
    const tangentTexts = tangentCall![1].messages.map((message) => (message.content[0] as any)?.text ?? "");
    expect(tangentTexts).not.toContain("main session task");

    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  tangent start");
    expect(transcript).toContain("default:tangent start");
    expect(transcript).not.toContain("You  contextual start");
    expect(overlay['modeText'].text).toContain("BTW tangent");
  });

  it("in-modal /btw:inject reuses command semantics by handing off to the main session and dismissing the overlay", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    const overlayHandle = harness.overlayHandles.at(-1);
    overlay.input.onSubmit?.("/btw:inject Use this in the main run.");
    await flushAsyncWork();

    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content: "Here is a side conversation I had. Use this in the main run.\n\nUser: first question\nAssistant: First answer",
      options: undefined,
    });
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(1);
    expect(overlayHandle?.hideCalls).toBe(1);
  });

  it("unsupported slash input in the modal surfaces BTW-local fallback and does not execute a command", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    const streamCallsBefore = streamSimpleMock.mock.calls.length;
    const sentUserMessagesBefore = harness.sentUserMessages.length;
    const resetCountBefore = getCustomEntries(harness.entries, "btw-thread-reset").length;
    const threadCountBefore = getCustomEntries(harness.entries, "btw-thread-entry").length;

    overlay.input.onSubmit?.("/plan do something else");
    await flushAsyncWork();

    expect(streamSimpleMock.mock.calls).toHaveLength(streamCallsBefore);
    expect(harness.sentUserMessages).toHaveLength(sentUserMessagesBefore);
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(resetCountBefore);
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(threadCountBefore);
    expect(overlay.statusText.text).toContain(
      "Unsupported slash input in BTW. Only /btw, /btw:new, /btw:tangent, /btw:clear, /btw:inject, and /btw:summarize run inside the modal.",
    );
    expect(harness.notifications.at(-1)).toEqual({
      message:
        "Unsupported slash input in BTW. Only /btw, /btw:new, /btw:tangent, /btw:clear, /btw:inject, and /btw:summarize run inside the modal.",
      type: "warning",
    });
    expect(transcriptText(overlay)).toContain("You  first question");
    expect(transcriptText(overlay)).toContain("First answer");
  });

  it("ordinary BTW follow-up submit and Escape dismissal do not send content to the main session", async () => {
    const harness = createHarness();
    streamSimpleMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("follow-up question");
    await flushAsyncWork();
    overlay.input.onEscape?.();
    await flushAsyncWork();

    expect(harness.sentUserMessages).toHaveLength(0);
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(2);
    expect(harness.overlayHandles.at(-1)?.hideCalls).toBe(1);
  });

  it("context filtering excludes BTW notes from main-session context while leaving non-BTW messages intact", async () => {
    const harness = createHarness();
    const results = await harness.runEvent("context", {
      messages: [
        { role: "user", content: [{ type: "text", text: "keep me" }] },
        { role: "custom", customType: "btw-note", content: "drop me" },
        { role: "assistant", content: [{ type: "text", text: "keep assistant" }] },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      messages: [
        { role: "user", content: [{ type: "text", text: "keep me" }] },
        { role: "assistant", content: [{ type: "text", text: "keep assistant" }] },
      ],
    });
  });
});

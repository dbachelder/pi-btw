import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  completeSimple,
  streamSimple,
  type AssistantMessage,
  type Message,
  type ThinkingLevel as AiThinkingLevel,
} from "@mariozechner/pi-ai";
import {
  Box,
  Container,
  Input,
  Spacer,
  Text,
  type Focusable,
  type KeybindingsManager,
  type OverlayHandle,
  type TUI,
} from "@mariozechner/pi-tui";

const BTW_MESSAGE_TYPE = "btw-note";
const BTW_ENTRY_TYPE = "btw-thread-entry";
const BTW_RESET_TYPE = "btw-thread-reset";

const BTW_SYSTEM_PROMPT = [
  "You are having an aside conversation with the user, separate from their main working session.",
  "If main session messages are provided, they are for context only — that work is being handled by another agent.",
  "If no main session messages are provided, treat this as a fully contextless tangent thread and rely only on the user's words plus your general instructions.",
  "Focus on answering the user's side questions, helping them think through ideas, or planning next steps.",
  "Do not act as if you need to continue unfinished work from the main session unless the user explicitly asks you to prepare something for injection back to it.",
].join(" ");

type SessionThinkingLevel = "off" | AiThinkingLevel;
type BtwThreadMode = "contextual" | "tangent";

type BtwDetails = {
  question: string;
  thinking: string;
  answer: string;
  provider: string;
  model: string;
  thinkingLevel: SessionThinkingLevel;
  timestamp: number;
  usage?: AssistantMessage["usage"];
};

type ParsedBtwArgs = {
  question: string;
  save: boolean;
};

type SaveState = "not-saved" | "saved" | "queued";

type BtwResetDetails = {
  timestamp: number;
  mode?: BtwThreadMode;
};

type BtwSlot = {
  question: string;
  modelLabel: string;
  thinking: string;
  answer: string;
  done: boolean;
  controller: AbortController;
};

type OverlayRuntime = {
  handle?: OverlayHandle;
  refresh?: () => void;
  close?: () => void;
};

function isVisibleBtwMessage(message: { role: string; customType?: string }): boolean {
  return message.role === "custom" && message.customType === BTW_MESSAGE_TYPE;
}

function isCustomEntry(entry: unknown, customType: string): entry is { type: "custom"; customType: string; data?: unknown } {
  return !!entry && typeof entry === "object" && (entry as { type?: string }).type === "custom" && (entry as { customType?: string }).customType === customType;
}

function toReasoning(level: SessionThinkingLevel): AiThinkingLevel | undefined {
  return level === "off" ? undefined : level;
}

function extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {
  const chunks: string[] = [];

  for (const part of parts) {
    if (type === "text" && part.type === "text") {
      chunks.push(part.text);
    } else if (type === "thinking" && part.type === "thinking") {
      chunks.push(part.thinking);
    }
  }

  return chunks.join("\n").trim();
}

function extractAnswer(message: AssistantMessage): string {
  return extractText(message.content, "text") || "(No text response)";
}

function extractThinking(message: AssistantMessage): string {
  return extractText(message.content, "thinking");
}

function parseBtwArgs(args: string): ParsedBtwArgs {
  const save = /(?:^|\s)(?:--save|-s)(?=\s|$)/.test(args);
  const question = args.replace(/(?:^|\s)(?:--save|-s)(?=\s|$)/g, " ").trim();
  return { question, save };
}

function buildMainMessages(ctx: ExtensionCommandContext): Message[] {
  const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
  return sessionContext.messages.filter((message) => !isVisibleBtwMessage(message));
}

function buildBtwContext(
  ctx: ExtensionCommandContext,
  question: string,
  thread: BtwDetails[],
  mode: BtwThreadMode,
) {
  const messages: Message[] = mode === "contextual" ? [...buildMainMessages(ctx)] : [];

  if (thread.length > 0) {
    messages.push(
      {
        role: "user",
        content: [{ type: "text", text: "[The following is a separate side conversation. Continue this thread.]" }],
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Understood, continuing our side conversation." }],
        provider: ctx.model?.provider ?? "unknown",
        model: ctx.model?.id ?? "unknown",
        api: ctx.model?.api ?? "openai-responses",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    );

    for (const entry of thread) {
      messages.push(
        {
          role: "user",
          content: [{ type: "text", text: entry.question }],
          timestamp: entry.timestamp,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: entry.answer }],
          provider: entry.provider,
          model: entry.model,
          api: ctx.model?.api ?? "openai-responses",
          usage:
            entry.usage ?? {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          stopReason: "stop",
          timestamp: entry.timestamp,
        },
      );
    }
  }

  messages.push({
    role: "user",
    content: [{ type: "text", text: question }],
    timestamp: Date.now(),
  });

  return {
    systemPrompt: [ctx.getSystemPrompt(), BTW_SYSTEM_PROMPT].filter(Boolean).join("\n\n"),
    messages,
  };
}

function buildBtwMessageContent(question: string, answer: string): string {
  return `Q: ${question}\n\nA: ${answer}`;
}

function formatThread(thread: BtwDetails[]): string {
  return thread.map((entry) => `User: ${entry.question.trim()}\nAssistant: ${entry.answer.trim()}`).join("\n\n---\n\n");
}

function saveVisibleBtwNote(
  pi: ExtensionAPI,
  details: BtwDetails,
  saveRequested: boolean,
  wasBusy: boolean,
): SaveState {
  if (!saveRequested) {
    return "not-saved";
  }

  const message = {
    customType: BTW_MESSAGE_TYPE,
    content: buildBtwMessageContent(details.question, details.answer),
    display: true,
    details,
  };

  if (wasBusy) {
    pi.sendMessage(message, { deliverAs: "followUp" });
    return "queued";
  }

  pi.sendMessage(message);
  return "saved";
}

function notify(ctx: ExtensionContext | ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}

function getOverlayTitle(mode: BtwThreadMode): string {
  return mode === "tangent" ? "BTW tangent" : "BTW";
}

function buildOverlayTranscript(slots: BtwSlot[]): string[] {
  if (slots.length === 0) {
    return ["No BTW thread yet. Ask a side question to start one."];
  }

  const lines: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (i > 0) {
      lines.push("", "────────────────────────────────────────");
    }

    lines.push(`You  ${slot.question}`);

    if (slot.thinking) {
      lines.push("", `Thinking${!slot.done && !slot.answer ? " ▍" : ""}`, slot.thinking);
    }

    if (slot.answer) {
      lines.push("", `Assistant${!slot.done ? " ▍" : ""}`, slot.answer);
    } else if (!slot.done) {
      lines.push("", "Assistant", "⏳ thinking...");
    }

    lines.push("", `Model  ${slot.modelLabel}`);
  }

  return lines;
}

class BtwOverlayComponent extends Container implements Focusable {
  private readonly input: Input;
  private readonly transcript: Container;
  private readonly statusText: Text;
  private readonly modeText: Text;
  private readonly summaryText: Text;
  private readonly hintsText: Text;
  private readonly getSlots: () => BtwSlot[];
  private readonly getStatus: () => string | null;
  private readonly getMode: () => BtwThreadMode;
  private readonly onSubmitCallback: (value: string) => void;
  private readonly onDismissCallback: () => void;
  private readonly tui: TUI;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    tui: TUI,
    _theme: ExtensionContext["ui"]["theme"],
    keybindings: KeybindingsManager,
    getSlots: () => BtwSlot[],
    getStatus: () => string | null,
    getMode: () => BtwThreadMode,
    onSubmit: (value: string) => void,
    onDismiss: () => void,
  ) {
    super();
    this.tui = tui;
    this.getSlots = getSlots;
    this.getStatus = getStatus;
    this.getMode = getMode;
    this.onSubmitCallback = onSubmit;
    this.onDismissCallback = onDismiss;

    this.addChild(new Text("", 0, 0));
    this.modeText = new Text("", 1, 0);
    this.addChild(this.modeText);
    this.addChild(new Spacer(1));

    this.summaryText = new Text("", 1, 0);
    this.addChild(this.summaryText);
    this.addChild(new Spacer(1));

    this.transcript = new Container();
    this.addChild(this.transcript);
    this.addChild(new Spacer(1));

    this.statusText = new Text("", 1, 0);
    this.addChild(this.statusText);
    this.addChild(new Spacer(1));

    this.input = new Input();
    this.input.onSubmit = (value) => {
      this.onSubmitCallback(value);
    };
    this.input.onEscape = () => {
      this.onDismissCallback();
    };
    this.addChild(this.input);
    this.addChild(new Spacer(1));

    this.hintsText = new Text("", 1, 0);
    this.addChild(this.hintsText);
    this.addChild(new Text("", 0, 0));

    const originalHandleInput = this.input.handleInput.bind(this.input);
    this.input.handleInput = (data: string) => {
      if (keybindings.matches(data, "selectCancel")) {
        this.onDismissCallback();
        return;
      }
      originalHandleInput(data);
    };

    this.refresh();
  }

  setDraft(value: string): void {
    this.input.setValue(value);
    this.tui.requestRender();
  }

  getDraft(): string {
    return this.input.getValue();
  }

  refresh(): void {
    this.modeText.setText(` ${getOverlayTitle(this.getMode())} · hidden thread preserved `);
    const slots = this.getSlots();
    const exchanges = slots.filter((slot) => slot.done).length;
    const active = slots.some((slot) => !slot.done) ? " · streaming" : " · idle";
    this.summaryText.setText(` ${exchanges} exchange${exchanges === 1 ? "" : "s"}${active}`);

    this.transcript.clear();
    for (const line of buildOverlayTranscript(slots)) {
      this.transcript.addChild(new Text(line, 1, 0));
    }

    const status = this.getStatus() ?? "Ready. Enter submits; Escape dismisses without clearing.";
    this.statusText.setText(` ${status}`);
    this.hintsText.setText(" Enter submit · Escape dismiss · /btw:clear resets thread ");
    this.tui.requestRender();
  }
}

export default function (pi: ExtensionAPI) {
  let pendingThread: BtwDetails[] = [];
  let pendingMode: BtwThreadMode = "contextual";
  let slots: BtwSlot[] = [];
  let widgetStatus: string | null = null;
  let overlayStatus: string | null = null;
  let overlayDraft = "";
  let overlayRuntime: OverlayRuntime | null = null;
  let lastUiContext: ExtensionContext | ExtensionCommandContext | null = null;

  function syncUi(ctx?: ExtensionContext | ExtensionCommandContext): void {
    const activeCtx = ctx ?? lastUiContext;
    if (activeCtx?.hasUI) {
      renderWidget(activeCtx);
      overlayRuntime?.refresh?.();
    }
  }

  function setOverlayStatus(status: string | null, ctx?: ExtensionContext | ExtensionCommandContext): void {
    overlayStatus = status;
    widgetStatus = status;
    syncUi(ctx);
  }

  function dismissOverlay(): void {
    overlayRuntime?.close?.();
    overlayRuntime = null;
  }

  function abortActiveSlots(): void {
    for (const slot of slots) {
      if (!slot.done) {
        slot.controller.abort();
      }
    }
  }

  function renderWidget(ctx: ExtensionContext | ExtensionCommandContext): void {
    if (!ctx.hasUI) {
      return;
    }

    if (slots.length === 0 && !widgetStatus) {
      ctx.ui.setWidget("btw", undefined);
      return;
    }

    ctx.ui.setWidget(
      "btw",
      (_tui, theme) => {
        const dim = (text: string) => theme.fg("dim", text);
        const success = (text: string) => theme.fg("success", text);
        const italic = (text: string) => theme.fg("dim", theme.italic(text));
        const warning = (text: string) => theme.fg("warning", text);
        const parts: string[] = [];

        const title = pendingMode === "tangent" ? " 💭 btw:tangent " : " 💭 btw ";
        const hint = " Esc dismiss · /btw:clear reset ";
        const width = Math.max(22, 68 - title.length - hint.length);
        parts.push(dim(`╭${title}${"─".repeat(width)}${hint}╮`));

        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (i > 0) {
            parts.push(dim("│ ───"));
          }

          parts.push(dim("│ ") + success("› ") + slot.question);

          if (slot.thinking) {
            const cursor = !slot.answer && !slot.done ? warning(" ▍") : "";
            parts.push(dim("│ ") + italic(slot.thinking) + cursor);
          }

          if (slot.answer) {
            const answerLines = slot.answer.split("\n");
            parts.push(dim("│ ") + answerLines[0]);
            if (answerLines.length > 1) {
              parts.push(answerLines.slice(1).join("\n"));
            }
            if (!slot.done) {
              parts[parts.length - 1] += warning(" ▍");
            }
          } else if (!slot.done) {
            parts.push(dim("│ ") + warning("⏳ thinking..."));
          }

          parts.push(dim("│ ") + dim(`model: ${slot.modelLabel}`));
        }

        if (widgetStatus) {
          parts.push(dim("│ ") + warning(widgetStatus));
        }

        parts.push(dim(`╰${"─".repeat(68)}╯`));
        return new Text(parts.join("\n"), 0, 0);
      },
      { placement: "aboveEditor" },
    );
  }

  async function ensureOverlay(ctx: ExtensionCommandContext | ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      return;
    }
    lastUiContext = ctx;

    if (overlayRuntime?.handle) {
      overlayRuntime.handle.setHidden(false);
      overlayRuntime.handle.focus();
      overlayRuntime.refresh?.();
      return;
    }

    const runtime: OverlayRuntime = {};
    overlayRuntime = runtime;

    runtime.close = () => {
      runtime.handle?.hide();
      overlayRuntime = null;
    };

    const component = await ctx.ui.custom<void>(
      async (tui, theme, keybindings, done) => {
        const overlay = new BtwOverlayComponent(
          tui,
          theme,
          keybindings,
          () => slots,
          () => overlayStatus,
          () => pendingMode,
          (value) => {
            overlayDraft = value;
            void submitFromOverlay(ctx, value);
          },
          () => {
            overlayDraft = overlay.getDraft();
            runtime.close?.();
            done();
          },
        );

        overlay.setDraft(overlayDraft);
        runtime.refresh = () => {
          overlay.refresh();
          if (!runtime.handle?.isFocused()) {
            overlay.focused = false;
          }
        };
        runtime.close = () => {
          overlayDraft = overlay.getDraft();
          runtime.handle?.hide();
          overlayRuntime = null;
        };

        return overlay;
      },
      {
        overlay: true,
        overlayOptions: {
          width: "78%",
          minWidth: 72,
          maxHeight: "78%",
          anchor: "center",
          margin: 1,
        },
        onHandle: (handle) => {
          runtime.handle = handle;
          handle.focus();
        },
      },
    );

    void component;
  }

  async function submitFromOverlay(ctx: ExtensionCommandContext | ExtensionContext, value: string): Promise<void> {
    const question = value.trim();
    if (!question) {
      setOverlayStatus("Enter a BTW prompt before submitting.", ctx);
      return;
    }

    if (!("getSystemPrompt" in ctx)) {
      setOverlayStatus("BTW overlay submit requires a command context. Reopen BTW from a command.", ctx);
      return;
    }

    overlayDraft = "";
    setOverlayStatus("⏳ streaming...", ctx);
    syncUi(ctx);
    await runBtw(ctx, question, false, pendingMode);
  }

  function resetThread(
    ctx: ExtensionContext | ExtensionCommandContext,
    persist = true,
    mode: BtwThreadMode = "contextual",
  ): void {
    abortActiveSlots();
    pendingThread = [];
    pendingMode = mode;
    slots = [];
    overlayDraft = "";
    setOverlayStatus(null, ctx);
    if (persist) {
      const details: BtwResetDetails = { timestamp: Date.now(), mode };
      pi.appendEntry(BTW_RESET_TYPE, details);
    }
    syncUi(ctx);
  }

  function restoreThread(ctx: ExtensionContext): void {
    abortActiveSlots();
    pendingThread = [];
    pendingMode = "contextual";
    slots = [];
    overlayDraft = "";
    lastUiContext = ctx;
    overlayStatus = null;
    widgetStatus = null;

    const branch = ctx.sessionManager.getBranch();
    let lastResetIndex = -1;

    for (let i = 0; i < branch.length; i++) {
      if (isCustomEntry(branch[i], BTW_RESET_TYPE)) {
        lastResetIndex = i;
        const details = branch[i].data as BtwResetDetails | undefined;
        pendingMode = details?.mode ?? "contextual";
      }
    }

    for (const entry of branch.slice(lastResetIndex + 1)) {
      if (!isCustomEntry(entry, BTW_ENTRY_TYPE)) {
        continue;
      }

      const details = entry.data as BtwDetails | undefined;
      if (!details?.question || !details.answer) {
        continue;
      }

      pendingThread.push(details);
      slots.push({
        question: details.question,
        modelLabel: `${details.provider}/${details.model}`,
        thinking: details.thinking || "",
        answer: details.answer,
        done: true,
        controller: new AbortController(),
      });
    }

    syncUi(ctx);
  }

  async function runBtw(
    ctx: ExtensionCommandContext,
    question: string,
    saveRequested: boolean,
    mode: BtwThreadMode,
  ): Promise<void> {
    lastUiContext = ctx;
    const model = ctx.model;
    if (!model) {
      setOverlayStatus("No active model selected.", ctx);
      notify(ctx, "No active model selected.", "error");
      return;
    }

    const apiKey = await ctx.modelRegistry.getApiKey(model);
    if (!apiKey) {
      const message = `No credentials available for ${model.provider}/${model.id}.`;
      setOverlayStatus(message, ctx);
      notify(ctx, message, "error");
      await ensureOverlay(ctx);
      return;
    }

    const wasBusy = !ctx.isIdle();
    pendingMode = mode;
    const thinkingLevel = pi.getThinkingLevel() as SessionThinkingLevel;
    const slot: BtwSlot = {
      question,
      modelLabel: `${model.provider}/${model.id}`,
      thinking: "",
      answer: "",
      done: false,
      controller: new AbortController(),
    };

    const threadSnapshot = pendingThread.slice();
    slots.push(slot);
    setOverlayStatus("⏳ streaming...", ctx);
    await ensureOverlay(ctx);

    try {
      const stream = streamSimple(model, buildBtwContext(ctx, question, threadSnapshot, mode), {
        apiKey,
        reasoning: toReasoning(thinkingLevel),
        signal: slot.controller.signal,
      });

      let response: AssistantMessage | null = null;

      for await (const event of stream) {
        if (event.type === "thinking_delta") {
          slot.thinking += event.delta;
          syncUi(ctx);
        } else if (event.type === "text_delta") {
          slot.answer += event.delta;
          syncUi(ctx);
        } else if (event.type === "done") {
          response = event.message;
        } else if (event.type === "error") {
          response = event.error;
        }
      }

      if (!response) {
        throw new Error("BTW request finished without a response.");
      }
      if (response.stopReason === "aborted") {
        const slotIndex = slots.indexOf(slot);
        if (slotIndex >= 0) {
          slots.splice(slotIndex, 1);
          setOverlayStatus("Request aborted.", ctx);
        }
        return;
      }
      if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "BTW request failed.");
      }

      const answer = extractAnswer(response);
      const thinking = extractThinking(response) || slot.thinking;
      slot.thinking = thinking;
      slot.answer = answer;
      slot.done = true;

      const details: BtwDetails = {
        question,
        thinking,
        answer,
        provider: model.provider,
        model: model.id,
        thinkingLevel,
        timestamp: Date.now(),
        usage: response.usage,
      };

      pendingThread.push(details);
      pi.appendEntry(BTW_ENTRY_TYPE, details);

      const saveState = saveVisibleBtwNote(pi, details, saveRequested, wasBusy);
      if (saveState === "saved") {
        notify(ctx, "Saved BTW note to the session.", "info");
        setOverlayStatus("Saved BTW note to the session.", ctx);
      } else if (saveState === "queued") {
        notify(ctx, "BTW note queued to save after the current turn finishes.", "info");
        setOverlayStatus("BTW note queued to save after the current turn finishes.", ctx);
      } else {
        setOverlayStatus("Ready for a follow-up. Hidden BTW thread updated.", ctx);
      }
    } catch (error) {
      if (slot.controller.signal.aborted) {
        const slotIndex = slots.indexOf(slot);
        if (slotIndex >= 0) {
          slots.splice(slotIndex, 1);
          setOverlayStatus("Request aborted.", ctx);
        }
        return;
      }

      slot.answer = `❌ ${error instanceof Error ? error.message : String(error)}`;
      slot.done = true;
      setOverlayStatus("Request failed. Thread preserved for retry or follow-up.", ctx);
      notify(ctx, error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function summarizeThread(ctx: ExtensionCommandContext, thread: BtwDetails[]): Promise<string> {
    const model = ctx.model;
    if (!model) {
      throw new Error("No active model selected.");
    }

    const apiKey = await ctx.modelRegistry.getApiKey(model);
    if (!apiKey) {
      throw new Error(`No credentials available for ${model.provider}/${model.id}.`);
    }

    const response = await completeSimple(
      model,
      {
        systemPrompt: "Summarize the side conversation concisely. Preserve key decisions, plans, insights, risks, and action items. Output only the summary.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: formatThread(thread) }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        reasoning: "low",
      },
    );

    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Failed to summarize BTW thread.");
    }
    if (response.stopReason === "aborted") {
      throw new Error("BTW summarize aborted.");
    }

    return extractAnswer(response);
  }

  function sendThreadToMain(ctx: ExtensionCommandContext, content: string): void {
    if (ctx.isIdle()) {
      pi.sendUserMessage(content);
    } else {
      pi.sendUserMessage(content, { deliverAs: "followUp" });
    }
  }

  pi.registerMessageRenderer(BTW_MESSAGE_TYPE, (message, { expanded }, theme) => {
    const details = message.details as BtwDetails | undefined;
    const content = typeof message.content === "string" ? message.content : "[non-text btw message]";
    const lines = [theme.fg("accent", theme.bold("[BTW]")), content];

    if (expanded && details) {
      lines.push(
        theme.fg("dim", `model: ${details.provider}/${details.model} · thinking: ${details.thinkingLevel}`),
      );

      if (details.usage) {
        lines.push(
          theme.fg(
            "dim",
            `tokens: in ${details.usage.input} · out ${details.usage.output} · total ${details.usage.totalTokens}`,
          ),
        );
      }
    }

    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });

  pi.on("context", async (event) => {
    return {
      messages: event.messages.filter((message) => !isVisibleBtwMessage(message)),
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    restoreThread(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    restoreThread(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreThread(ctx);
  });

  pi.on("session_shutdown", async () => {
    abortActiveSlots();
    dismissOverlay();
  });

  pi.registerCommand("btw", {
    description: "Continue a side conversation in a focused BTW modal. Add --save to also persist a visible note.",
    handler: async (args, ctx) => {
      const { question, save } = parseBtwArgs(args);
      if (!question) {
        notify(ctx, "Usage: /btw [--save] <question>", "warning");
        await ensureOverlay(ctx);
        return;
      }

      if (pendingMode !== "contextual") {
        resetThread(ctx, true, "contextual");
      }

      await runBtw(ctx, question, save, "contextual");
    },
  });

  pi.registerCommand("btw:tangent", {
    description: "Start or continue a contextless BTW tangent in the focused BTW modal.",
    handler: async (args, ctx) => {
      const { question, save } = parseBtwArgs(args);
      if (!question) {
        notify(ctx, "Usage: /btw:tangent [--save] <question>", "warning");
        await ensureOverlay(ctx);
        return;
      }

      if (pendingMode !== "tangent") {
        resetThread(ctx, true, "tangent");
      }

      await runBtw(ctx, question, save, "tangent");
    },
  });

  pi.registerCommand("btw:new", {
    description: "Start a fresh BTW thread with main-session context. Optionally ask the first question immediately.",
    handler: async (args, ctx) => {
      resetThread(ctx, true, "contextual");
      const { question, save } = parseBtwArgs(args);
      if (question) {
        await runBtw(ctx, question, save, "contextual");
      } else {
        setOverlayStatus("Started a fresh BTW thread.", ctx);
        await ensureOverlay(ctx);
        notify(ctx, "Started a fresh BTW thread.", "info");
      }
    },
  });

  pi.registerCommand("btw:clear", {
    description: "Dismiss the BTW modal/widget and clear the current thread.",
    handler: async (_args, ctx) => {
      resetThread(ctx);
      dismissOverlay();
      notify(ctx, "Cleared BTW thread.", "info");
    },
  });

  pi.registerCommand("btw:inject", {
    description: "Inject the full BTW thread into the main agent as a user message.",
    handler: async (args, ctx) => {
      if (pendingThread.length === 0) {
        notify(ctx, "No BTW thread to inject.", "warning");
        return;
      }

      const instructions = args.trim();
      const content = instructions
        ? `Here is a side conversation I had. ${instructions}\n\n${formatThread(pendingThread)}`
        : `Here is a side conversation I had for additional context:\n\n${formatThread(pendingThread)}`;

      sendThreadToMain(ctx, content);
      const count = pendingThread.length;
      resetThread(ctx);
      dismissOverlay();
      notify(ctx, `Injected BTW thread (${count} exchange${count === 1 ? "" : "s"}).`, "info");
    },
  });

  pi.registerCommand("btw:summarize", {
    description: "Summarize the BTW thread, then inject the summary into the main agent.",
    handler: async (args, ctx) => {
      if (pendingThread.length === 0) {
        notify(ctx, "No BTW thread to summarize.", "warning");
        return;
      }

      setOverlayStatus("⏳ summarizing...", ctx);
      await ensureOverlay(ctx);

      try {
        const summary = await summarizeThread(ctx, pendingThread);
        const instructions = args.trim();
        const content = instructions
          ? `Here is a summary of a side conversation I had. ${instructions}\n\n${summary}`
          : `Here is a summary of a side conversation I had:\n\n${summary}`;

        sendThreadToMain(ctx, content);
        const count = pendingThread.length;
        resetThread(ctx);
        dismissOverlay();
        notify(ctx, `Injected BTW summary (${count} exchange${count === 1 ? "" : "s"}).`, "info");
      } catch (error) {
        setOverlayStatus("Summarize failed. Thread preserved for retry or injection.", ctx);
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

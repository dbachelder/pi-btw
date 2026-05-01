import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Params = Record<string, string | number>;
type Translate = (key: string, fallback: string, params?: Params) => string;

let translate: Translate = (_key, fallback, params) => format(fallback, params);

function format(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(params[key] ?? `{${key}}`));
}

export function t(key: string, fallback: string, params?: Params): string {
  return translate(key, fallback, params);
}

const bundles = [
  {
    locale: "ja",
    namespace: "pi-btw",
    messages: {
      "shortcut.focus": "BTW オーバーレイを開いたままフォーカスを切り替えます。",
      "cmd.btw": "フォーカスされた BTW モーダルでサイド会話を続けます。--save を付けると表示されるメモとしても保存します。",
      "cmd.tangent": "フォーカスされた BTW モーダルで、文脈を引き継がない BTW タンジェントを開始または継続します。",
      "cmd.new": "メインセッションの文脈を使って新しい BTW スレッドを開始します。任意で最初の質問もすぐに送れます。",
      "cmd.clear": "BTW モーダル/ウィジェットを閉じ、現在のスレッドをクリアします。",
      "cmd.inject": "BTW スレッド全体をユーザーメッセージとしてメインエージェントに注入します。",
      "cmd.summarize": "BTW スレッドを要約し、その要約をメインエージェントに注入します。",
      "cmd.model": "BTW 専用モデル override を表示、設定、またはクリアします。",
      "cmd.thinking": "BTW 専用 thinking override を表示、設定、またはクリアします。",
    },
  },
  {
    locale: "zh-TW",
    namespace: "pi-btw",
    messages: {
      "shortcut.focus": "切換 BTW overlay focus，但保持 overlay 開啟。",
      "cmd.btw": "在聚焦的 BTW modal 中繼續一段側邊對話。加入 --save 也會保存成可見筆記。",
      "cmd.tangent": "在聚焦的 BTW modal 中開始或繼續不帶上下文的 BTW tangent。",
      "cmd.new": "使用主 session 上下文開始新的 BTW thread。也可以立即附上第一個問題。",
      "cmd.clear": "關閉 BTW modal/widget，並清除目前 thread。",
      "cmd.inject": "把完整 BTW thread 以 user message 注入主 agent。",
      "cmd.summarize": "摘要 BTW thread，然後把摘要注入主 agent。",
      "cmd.model": "顯示、設定或清除 BTW-only model override。",
      "cmd.thinking": "顯示、設定或清除 BTW-only thinking override。",
    },
  },
  {
    locale: "es",
    namespace: "pi-btw",
    messages: {
      "shortcut.focus": "Alterna el foco del overlay BTW sin cerrarlo.",
      "cmd.btw": "Continúa una conversación lateral en el modal BTW enfocado. Añade --save para guardar también una nota visible.",
      "cmd.tangent": "Inicia o continúa una tangent BTW sin contexto en el modal BTW enfocado.",
      "cmd.new": "Inicia un hilo BTW nuevo con contexto de la sesión principal. Opcionalmente haz la primera pregunta de inmediato.",
      "cmd.clear": "Cierra el modal/widget BTW y borra el hilo actual.",
      "cmd.inject": "Inyecta el hilo BTW completo en el agente principal como mensaje de usuario.",
      "cmd.summarize": "Resume el hilo BTW y luego inyecta el resumen en el agente principal.",
      "cmd.model": "Muestra, configura o borra el override de modelo exclusivo de BTW.",
      "cmd.thinking": "Muestra, configura o borra el override de thinking exclusivo de BTW.",
    },
  },
];

export function initI18n(pi: ExtensionAPI): void {
  const events = pi.events;
  if (!events) return;
  for (const bundle of bundles) events.emit("pi-core/i18n/registerBundle", bundle);
  events.emit("pi-core/i18n/requestApi", {
    namespace: "pi-btw",
    callback(api: { t?: Translate } | undefined) {
      if (typeof api?.t === "function") translate = api.t;
    },
  });
}

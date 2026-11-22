import type { Settings, UsedFor } from "@/lib/types";

export type ProviderId = "claude" | "codex" | "copilot" | "kimi" | "mflux";

export type AdvancedField = {
  group: keyof Settings["providers"];
  key: "config_dir" | "model" | "bin";
  label: string;
  placeholder: string;
  hint: string;
};

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  /** One plain sentence about what it is. */
  blurb: string;
  advanced?: AdvancedField;
};

/** The five tools from docs/onboarding-and-mobile.md, in the order the setup page shows them. */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "claude",
    name: "Claude Code",
    blurb: "Anthropic's assistant. A careful brain for planning decor and looking up venues.",
    advanced: {
      group: "claude",
      key: "config_dir",
      label: "Claude config folder",
      placeholder: "~/.claude",
      hint: "Only if you have more than one Claude login: the folder that holds the one to use (CLAUDE_CONFIG_DIR).",
    },
  },
  {
    id: "codex",
    name: "Codex",
    blurb: "OpenAI's assistant, part of ChatGPT plans. It can be the brain and the image engine.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    blurb: "GitHub's assistant. It can be the brain and the image engine.",
    advanced: {
      group: "copilot",
      key: "model",
      label: "Copilot chat model",
      placeholder: "Copilot's default",
      hint: "Leave empty to let Copilot choose. Type a model name to always chat with that one.",
    },
  },
  {
    id: "kimi",
    name: "Kimi Code",
    blurb: "Moonshot AI's assistant. A brain for chat and web research.",
    advanced: {
      group: "kimi",
      key: "bin",
      label: "Kimi command",
      placeholder: "kimi",
      hint: "Only if Kimi is installed somewhere unusual: the full path to the kimi command.",
    },
  },
  {
    id: "mflux",
    name: "Local FLUX (mflux)",
    blurb: "An image engine that runs on this Mac, free and offline. Slower, and it needs Apple Silicon.",
  },
];

export const USED_FOR_LABELS: Record<UsedFor, string> = {
  chat: "Chat",
  web_research: "Web research",
  vision: "Reading photos",
  images: "Images",
};

/** Image tests that don't spend anything run straight away (docs/onboarding-and-mobile.md, section 3). */
export const FREE_ENGINES = new Set(["mock", "mflux"]);

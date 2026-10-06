import { detectDesktopOs, type DesktopOs } from "@/lib/desktop-os";

export const GUIDE_CHOICE_EVENT = "godmode:guide-choice";

export const GUIDE_NEXT_QUESTION = "How do you want to move forward?";

export const GUIDE_NEXT_WHY =
  "Local with Inference keeps GodMode on your computer and adds the models. Cloud with Inference hosts the workspace and the models, so you are not running it on this machine. Inference alone is the model supply. Cloud alone is the hosted workspace. Seller is how a local install sells on marketplace.";

export type GuideNextOption = { id: string; label: string };

export const GUIDE_NEXT_OPTIONS: GuideNextOption[] = [
  { id: "download", label: "Download for my computer" },
  { id: "inference", label: "GodMode Inference" },
  { id: "cloud", label: "GodMode Cloud" },
  { id: "cloud_inference", label: "Cloud with Inference" },
  { id: "seller", label: "GodMode Seller" },
];

export type GuideChoiceCard = {
  question: string;
  why: string;
  options: GuideNextOption[];
};

export type GuideChoiceCompareRow = {
  label: string;
  value: string;
};

export type GuideChoiceProfile = {
  optionId: string;
  /** Card heading. Falls back to the option label when omitted. */
  title?: string;
  rows: GuideChoiceCompareRow[];
  /** One sentence under the comparison rows, beside the button. */
  sell: string;
};

/** Same row labels on every path so the cards compare line by line. */
export const GUIDE_CHOICE_PROFILES: GuideChoiceProfile[] = [
  {
    optionId: "download",
    title: "GodMode Local",
    rows: [
      { label: "Where it runs", value: "This computer" },
      { label: "Workspace", value: "Local" },
      { label: "Models", value: "GodMode Inference, BYOK, or local GGUF via llama.cpp" },
      { label: "Marketplace", value: "Personal use" },
    ],
    sell: "GodMode stays on this machine, and you run the workspace yourself.",
  },
  {
    optionId: "inference",
    rows: [
      { label: "Where it runs", value: "With your install" },
      { label: "Workspace", value: "Stays where it is" },
      { label: "Models", value: "Included" },
      { label: "Marketplace", value: "Personal use" },
    ],
    sell: "Pair a local install with the model supply so the models come with GodMode.",
  },
  {
    optionId: "cloud",
    rows: [
      { label: "Where it runs", value: "GodMode Cloud" },
      { label: "Workspace", value: "Hosted" },
      { label: "Models", value: "BYOK" },
      { label: "Marketplace", value: "Included" },
    ],
    sell: "The workspace is hosted, so you are not running GodMode on this machine.",
  },
  {
    optionId: "cloud_inference",
    rows: [
      { label: "Where it runs", value: "GodMode Cloud" },
      { label: "Workspace", value: "Hosted" },
      { label: "Models", value: "Included" },
      { label: "Marketplace", value: "Included" },
    ],
    sell: "The hosted workspace includes the models, so you are not running either on this machine.",
  },
  {
    optionId: "seller",
    rows: [
      { label: "Where it runs", value: "This computer" },
      { label: "Workspace", value: "Local" },
      { label: "Models", value: "Not included" },
      { label: "Marketplace", value: "Sell from GodMode Local (Downloaded)." },
    ],
    sell: "A monthly subscription for GodMode Local users to sell on GodMode Marketplace.",
  },
];

export function guideChoiceProfilesForOptions(
  options: GuideNextOption[]
): Array<GuideChoiceProfile & { label: string; title: string }> {
  const byId = new Map(GUIDE_CHOICE_PROFILES.map((profile) => [profile.optionId, profile]));
  return options.flatMap((option) => {
    const profile = byId.get(option.id);
    return profile
      ? [{ ...profile, label: option.label, title: profile.title ?? option.label }]
      : [];
  });
}

const OS_DOWNLOAD_LABEL: Record<DesktopOs, string> = {
  windows: "Download for Windows",
  macos: "Download for macOS",
  linux: "Download for Linux",
};

export function canonicalGuideChoice(): GuideChoiceCard {
  return {
    question: GUIDE_NEXT_QUESTION,
    why: GUIDE_NEXT_WHY,
    options: GUIDE_NEXT_OPTIONS.map((option) => ({ ...option })),
  };
}

/** True when a guide_choice payload is the Explore / buy-path card set. */
export function isCanonicalGuideChoice(card: GuideChoiceCard | null | undefined): boolean {
  if (!card?.options?.length) return false;
  if (card.question.trim() !== GUIDE_NEXT_QUESTION) return false;
  const ids = new Set(card.options.map((option) => option.id));
  return GUIDE_NEXT_OPTIONS.every((option) => ids.has(option.id));
}

export function downloadLabelForUserAgent(userAgent: string): string {
  const os = detectDesktopOs(userAgent);
  return os ? OS_DOWNLOAD_LABEL[os] : "Download for my computer";
}

export function choiceOptionsForUserAgent(
  options: GuideNextOption[],
  userAgent: string
): GuideNextOption[] {
  const download = downloadLabelForUserAgent(userAgent);
  return options.map((option) =>
    option.id === "download" ? { ...option, label: download } : option
  );
}

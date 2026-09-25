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

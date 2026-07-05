import {
  AnchorIcon,
  BirdIcon,
  BugIcon,
  CatIcon,
  CompassIcon,
  DicesIcon,
  DogIcon,
  FeatherIcon,
  FishIcon,
  FlameIcon,
  Gamepad2Icon,
  GemIcon,
  GhostIcon,
  LeafIcon,
  PuzzleIcon,
  RabbitIcon,
  RocketIcon,
  SnailIcon,
  SquirrelIcon,
  TargetIcon,
  TurtleIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

/** Fun emoji pool — deterministic per user id when profile has no custom emoji. */
const FUN_USER_EMOJIS = [
  "🦊", "🐸", "🦄", "🐙", "🦖", "🐧", "🦉", "🐝", "🦋", "🐳",
  "🌮", "🍕", "🧋", "🍩", "🥑", "🌶️", "🍉", "🧁", "🍜", "🥐",
  "🚀", "🛸", "🎸", "🎲", "🧩", "🎯", "🪐", "⚡", "🔮", "🎪",
  "🦩", "🐨", "🦥", "🐲", "🦈", "🐺", "🦜", "🐯", "🦔", "🐼",
] as const;

function hashUserId(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Stable fun emoji for a user (same id → same emoji every session). */
export function defaultAvatarEmoji(userId: string): string {
  const idx = hashUserId(userId) % FUN_USER_EMOJIS.length;
  return FUN_USER_EMOJIS[idx]!;
}

/** Monochrome lucide icon pool — same black/white treatment as the GodMode crown. */
const FUN_USER_ICONS: readonly LucideIcon[] = [
  CatIcon, DogIcon, BirdIcon, FishIcon, RabbitIcon, SquirrelIcon,
  SnailIcon, TurtleIcon, BugIcon, FeatherIcon, LeafIcon, GhostIcon,
  RocketIcon, Gamepad2Icon, DicesIcon, PuzzleIcon, TargetIcon, GemIcon,
  AnchorIcon, CompassIcon, FlameIcon, ZapIcon,
] as const;

/** Stable lucide icon for a user (same id → same icon every session). */
export function defaultAvatarIcon(userId: string): LucideIcon {
  const idx = hashUserId(userId) % FUN_USER_ICONS.length;
  return FUN_USER_ICONS[idx]!;
}

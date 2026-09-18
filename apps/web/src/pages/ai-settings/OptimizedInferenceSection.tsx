import { ExternalLinkIcon, KeyRoundIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeepSeekCard } from "@/pages/ai-settings/DeepSeekCard";
import { ZaiPaygCard } from "@/pages/ai-settings/ZaiPaygCard";
import { QwenDashScopeCard } from "@/pages/ai-settings/QwenDashScopeCard";
import { useTenant } from "@/lib/tenant-context";

const SIGNUP_LINKS = [
  {
    name: "DeepSeek",
    href: "https://platform.deepseek.com/",
    note: "Your account + API key",
  },
  {
    name: "Z.AI (GLM payg)",
    href: "https://z.ai/",
    note: "Your payg key (not Coding Plan)",
  },
  {
    name: "Qwen / DashScope",
    href: "https://modelstudio.console.alibabacloud.com/",
    note: "Your Alibaba Cloud Model Studio API key",
  },
] as const;

/**
 * Personal / workspace BYOK for DeepSeek, Z.AI payg, and Qwen.
 * Platform-wide GodMode Inference supply for new-user guidance lives under
 * Admin → GodMode Inference, not here.
 */
export function OptimizedInferenceSection({
  vaultAgentId = null,
}: {
  vaultAgentId?: string | null;
}) {
  const { user } = useTenant();
  const isAdmin = Boolean(user?.isAdmin);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">Preferred BYOK</h2>
        <p className="text-sm text-muted-foreground">
          Your own DeepSeek, Z.AI (GLM payg), and Qwen keys after you graduate
          from guided onboarding. Stored in your Platform Vault.
          {isAdmin ? (
            <>
              {" "}
              Platform-wide keys for new-user GodMode Inference belong in{" "}
              <button
                type="button"
                className="font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("godmode:open-admin", {
                      detail: { tab: "inference" },
                    })
                  );
                }}
              >
                Admin → GodMode Inference
              </button>
              .
            </>
          ) : null}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRoundIcon className="size-4" />
            Sign up (personal)
          </CardTitle>
          <CardDescription>
            Create your own provider accounts, then paste keys below. This is
            personal BYOK, not admin platform supply.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {SIGNUP_LINKS.map((link) => (
              <li
                key={link.name}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
              >
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                >
                  {link.name}
                  <ExternalLinkIcon className="size-3" />
                </a>
                <span className="text-muted-foreground">{link.note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <DeepSeekCard vaultAgentId={vaultAgentId} />
      <ZaiPaygCard vaultAgentId={vaultAgentId} />
      <QwenDashScopeCard vaultAgentId={vaultAgentId} />
    </section>
  );
}

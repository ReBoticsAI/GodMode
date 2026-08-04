import { useState } from "react";
import { BanknoteIcon, BitcoinIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useHoldings } from "@/hooks/use-holdings";
import { saveMoralisConfig, savePayPalConfig } from "@/lib/api-holdings";

/**
 * Moralis + PayPal credential setup for Vault → Wallets & Accounts live sync.
 * Wallet and account connect flows live on the same Vault tab.
 */
export function HoldingsConnectCard() {
  const { config, refresh } = useHoldings();
  const [moralisKey, setMoralisKey] = useState("");
  const [paypalId, setPaypalId] = useState("");
  const [paypalSecret, setPaypalSecret] = useState("");
  const [paypalEnv, setPaypalEnv] = useState<"sandbox" | "live">("sandbox");
  const [busy, setBusy] = useState<string | null>(null);

  const saveMoralis = async () => {
    if (!moralisKey.trim()) return;
    setBusy("moralis");
    try {
      await saveMoralisConfig(moralisKey.trim());
      toast.success("Moralis API key saved and verified");
      setMoralisKey("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Moralis setup failed");
    } finally {
      setBusy(null);
    }
  };

  const savePayPal = async () => {
    if (!paypalId.trim() || !paypalSecret.trim()) return;
    setBusy("paypal");
    try {
      await savePayPalConfig({
        clientId: paypalId.trim(),
        clientSecret: paypalSecret.trim(),
        env: paypalEnv,
      });
      toast.success("PayPal credentials saved and verified");
      setPaypalId("");
      setPaypalSecret("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PayPal setup failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BitcoinIcon className="size-4" />
            Moralis
          </CardTitle>
          <CardDescription>
            Web3 API key for live crypto wallet portfolios under Vault → Wallets
            & Accounts. Credentials are encrypted and stored on this host.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={config?.moralis.configured ? "default" : "secondary"}>
              {config?.moralis.configured ? "Configured" : "Not configured"}
            </Badge>
            {config?.moralis.configured && config.moralis.masked ? (
              <span className="font-mono text-xs text-muted-foreground">
                {config.moralis.masked}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs">API key</Label>
            <Input
              type="password"
              value={moralisKey}
              onChange={(e) => setMoralisKey(e.target.value)}
              placeholder="Paste Moralis Web3 API key"
              autoComplete="off"
            />
            <Button
              type="button"
              size="sm"
              className="w-fit"
              disabled={busy === "moralis" || !moralisKey.trim()}
              onClick={() => void saveMoralis()}
            >
              {busy === "moralis" ? <Spinner className="size-3.5" /> : null}
              Save & test Moralis
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BanknoteIcon className="size-4" />
            PayPal business
          </CardTitle>
          <CardDescription>
            Business app client ID and secret for live PayPal balance sync under
            Vault → Wallets & Accounts. The app needs Transaction Search /
            Reporting enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={config?.paypal.configured ? "default" : "secondary"}>
              {config?.paypal.configured ? "Configured" : "Not configured"}
            </Badge>
            {config?.paypal.configured ? (
              <span className="font-mono text-xs text-muted-foreground">
                {config.paypal.env}
                {config.paypal.clientIdMasked
                  ? ` · ${config.paypal.clientIdMasked}`
                  : ""}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Client ID</Label>
            <Input
              value={paypalId}
              onChange={(e) => setPaypalId(e.target.value)}
              placeholder="Client ID"
              autoComplete="off"
            />
            <Label className="text-xs">Client secret</Label>
            <Input
              type="password"
              value={paypalSecret}
              onChange={(e) => setPaypalSecret(e.target.value)}
              placeholder="Client secret"
              autoComplete="off"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={paypalEnv === "sandbox" ? "default" : "outline"}
                onClick={() => setPaypalEnv("sandbox")}
              >
                Sandbox
              </Button>
              <Button
                type="button"
                size="sm"
                variant={paypalEnv === "live" ? "default" : "outline"}
                onClick={() => setPaypalEnv("live")}
              >
                Live
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              className="w-fit"
              disabled={
                busy === "paypal" || !paypalId.trim() || !paypalSecret.trim()
              }
              onClick={() => void savePayPal()}
            >
              {busy === "paypal" ? <Spinner className="size-3.5" /> : null}
              Save & test PayPal
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

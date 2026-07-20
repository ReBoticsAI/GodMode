import { useState } from "react";
import { beginMfaEnroll, confirmMfaEnroll } from "@/api";
import { OtpauthQr } from "@/components/auth/OtpauthQr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/** TOTP enroll UI shared by Settings and the SaaS admin MFA hard gate. */
export function MfaEnrollForm(props: { onEnrolled: () => void | Promise<void> }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const res = await beginMfaEnroll();
      setSecret(res.secretBase32);
      setOtpauthUrl(res.otpauthUrl);
      setRecoveryCodes(res.recoveryCodes);
      toast.message("Scan the QR code, then confirm with a 6-digit code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start MFA");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await confirmMfaEnroll(code.trim());
      setSecret(null);
      setOtpauthUrl(null);
      setCode("");
      toast.success("MFA enabled");
      await props.onEnrolled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  if (secret) {
    return (
      <div className="flex flex-col gap-3">
        {otpauthUrl ? <OtpauthQr otpauthUrl={otpauthUrl} /> : null}
        <p className="text-sm break-all">
          Or enter secret: <code className="text-xs">{secret}</code>
        </p>
        {recoveryCodes.length > 0 ? (
          <div className="rounded-md border border-border p-2 text-xs">
            <p className="mb-1 font-medium">Recovery codes (store offline)</p>
            <ul className="space-y-0.5 font-mono">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mfa-gate-confirm">Confirm code</Label>
          <Input
            id="mfa-gate-confirm"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoComplete="one-time-code"
            inputMode="numeric"
          />
        </div>
        <Button type="button" disabled={busy} onClick={() => void confirm()}>
          Confirm MFA
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Platform admins on GodMode Cloud must enroll authenticator MFA before
        using the product.
      </p>
      <Button type="button" disabled={busy} onClick={() => void startEnroll()}>
        Enroll authenticator
      </Button>
    </div>
  );
}

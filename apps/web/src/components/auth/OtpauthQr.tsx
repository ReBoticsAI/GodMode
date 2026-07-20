import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Client-side QR for a TOTP otpauth:// URI (never hits a third-party QR API). */
export function OtpauthQr(props: { otpauthUrl: string; label?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    void QRCode.toDataURL(props.otpauthUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 192,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("Could not render QR code");
      });
    return () => {
      cancelled = true;
    };
  }, [props.otpauthUrl]);

  if (error) {
    return <p className="text-xs text-muted-foreground">{error}</p>;
  }
  if (!dataUrl) {
    return (
      <div
        className="size-48 animate-pulse rounded-md bg-muted"
        aria-hidden
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={dataUrl}
        alt={props.label ?? "Authenticator QR code"}
        width={192}
        height={192}
        className="rounded-md bg-white p-2"
      />
      <p className="text-center text-xs text-muted-foreground">
        Scan with Google Authenticator or any TOTP app
      </p>
    </div>
  );
}

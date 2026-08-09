import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Génère et affiche un vrai QR Code (canvas SVG dataURL) pour appairer
 * deux appareils GeniusFiles.
 */
export function QrDisplay({ value, size = 160 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: "#0F1626", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className="flex items-center justify-center rounded-xl bg-white p-2"
      style={{ width: size, height: size }}
    >
      {dataUrl ? (
        <img src={dataUrl} alt="QR d'appairage" width={size - 16} height={size - 16} />
      ) : (
        <div className="h-full w-full animate-pulse rounded-lg bg-secondary" />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { Camera, CameraOff } from "lucide-react";

/**
 * Scanner de QR Code caméra pour l'appairage. Utilise @zxing/browser
 * (WebRTC getUserMedia + décodage local). Fonctionne dans la WebView
 * Capacitor dès lors que la permission CAMERA a été accordée.
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserQRCodeReader();

    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
          if (cancelled) return;
          if (result) {
            onResult(result.getText());
          }
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setRunning(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Caméra indisponible");
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [onResult]);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-primary/70" />
      </div>
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        {error ? (
          <>
            <CameraOff className="h-3.5 w-3.5" /> {error}
          </>
        ) : (
          <>
            <Camera className="h-3.5 w-3.5" />{" "}
            {running ? "Visez le QR code de l'autre appareil" : "Initialisation caméra…"}
          </>
        )}
      </p>
    </div>
  );
}

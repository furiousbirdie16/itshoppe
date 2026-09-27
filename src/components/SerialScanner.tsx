import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff } from "lucide-react";
import { barcodeDetectorCtor } from "@/lib/scanning";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called for each distinct code read. The panel stays open for the next unit. */
  onScan: (value: string) => void;
  title?: string;
}

export function SerialScanner({ open, onOpenChange, onScan, title = "Scan a serial" }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [lastValue, setLastValue] = useState("");

  useEffect(() => {
    if (!open) return;
    const Ctor = barcodeDetectorCtor();
    if (!Ctor) { setError("This browser cannot use the camera to scan. Type the serial instead."); return; }

    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    // The same code sits in front of the lens for many frames; without this a
    // single label would fire dozens of times.
    let lastSeen = "";
    let lastSeenAt = 0;
    const detector = new Ctor({ formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"] });

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          const found = await detector.detect(video);
          const value = found[0]?.rawValue?.trim();
          const now = Date.now();
          if (value && (value !== lastSeen || now - lastSeenAt > 2500)) {
            lastSeen = value;
            lastSeenAt = now;
            setLastValue(value);
            onScan(value);
          }
        } catch {
          // A single unreadable frame is normal; the next one usually reads.
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        frame = requestAnimationFrame(tick);
      })
      .catch(() => setError("Could not open the camera. Check the browser's camera permission."));

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      // Leaving the track running keeps the phone's camera light on.
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onScan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-lg">{title}</DialogTitle></DialogHeader>
        {error ? (
          <div className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <CameraOff className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">{error}</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg border bg-black">
              <video ref={videoRef} playsInline muted className="w-full aspect-[4/3] object-cover" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-32 w-48 rounded-lg border-2 border-white/70" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Camera className="h-3 w-3" />
              Point at the code. It keeps scanning, so hold up each unit in turn.
            </p>
            {lastValue && (
              <p className="font-mono text-xs">Last read: {lastValue}</p>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

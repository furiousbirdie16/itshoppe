import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff } from "lucide-react";
import { loadDetector, createScanGate } from "@/lib/scanning";

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
  const [ready, setReady] = useState(false);

  // Held in a ref so the effect below does not depend on it. The caller passes
  // an inline arrow, which is a new function on every render — as a dependency
  // it tore the scanner down and rebuilt it constantly, wiping the memory of
  // what had just been read. That is what made one label scan twice.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!open) return;

    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    // The rules for when a reading is real live in lib/scanning, where they can
    // be exercised without a camera.
    const gate = createScanGate();
    let detector: Awaited<ReturnType<typeof loadDetector>> = null;

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (detector && video && video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          const found = await detector.detect(video);
          // detect() is awaited, so the scanner can have been closed meanwhile.
          // Without this the closing frame still reported a read.
          if (stopped) return;

          const settled = gate(found[0]?.rawValue, Date.now());
          if (settled) {
            setLastValue(settled);
            onScanRef.current(settled);
          }
        } catch {
          // A single unreadable frame is normal; the next one usually reads.
        }
      }
      frame = requestAnimationFrame(tick);
    };

    // The reader is fetched alongside the camera. On a browser with none of its
    // own this downloads one, which is why it is awaited rather than assumed.
    void (async () => {
      try {
        detector = await loadDetector(["qr_code", "code_128", "code_39", "ean_13", "data_matrix"]);
        if (stopped) return;
        if (!detector) {
          setError("This device has no camera to scan with. Type the serial instead.");
          return;
        }

        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setReady(true);
        frame = requestAnimationFrame(tick);
      } catch {
        if (!stopped) setError("Could not open the camera. Check the browser's camera permission.");
      }
    })();

    return () => {
      stopped = true;
      setReady(false);
      cancelAnimationFrame(frame);
      // Leaving the track running keeps the phone's camera light on.
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

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
              {ready
                ? "Point at the code. It keeps scanning, so hold up each unit in turn."
                : "Starting the camera…"}
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

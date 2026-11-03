import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff } from "lucide-react";
import { loadDetector, createScanGate, pickAimed, AIM_MARGIN } from "@/lib/scanning";

/** Time to aim after the camera opens, before anything can be read. */
const ARM_DELAY_MS = 1500;
/** How long a code must stay in the box. Long enough that passing over one does not record it. */
const HOLD_MS = 700;

/**
 * Asks the lens for its widest setting. Phones often open a little zoomed in,
 * which is what forced stepping back from a label to fit it in. Not every
 * camera offers this, and one that does not simply stays as it is.
 */
async function zoomAllTheWayOut(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as { zoom?: { min: number } } | undefined;
  if (!caps?.zoom) return;
  try {
    await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as MediaTrackConstraintSet] });
  } catch {
    // Scanning at the default zoom still works.
  }
}

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
  const [armed, setArmed] = useState(false);
  // The camera's real shape, so the preview shows the whole of what is being
  // read. Cropping it to a fixed shape made the view look zoomed in, and codes
  // out of sight could still be read.
  const [aspect, setAspect] = useState(4 / 3);
  // Shown in small print. When a scanner reads nothing there is no way to tell
  // a dead loop from a loop that is running and finding nothing, and these two
  // numbers separate them at a glance.
  const [diagnostics, setDiagnostics] = useState("");

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
    const gate = createScanGate({ armDelayMs: ARM_DELAY_MS, requiredMs: HOLD_MS });
    let detector: Awaited<ReturnType<typeof loadDetector>> = null;
    let framesRead = 0;
    let armTimer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      // HAVE_CURRENT_DATA, not HAVE_ENOUGH_DATA: a live camera stream on iOS
      // often never reports the latter, so the frame was never looked at and
      // the preview sat there decoding nothing. videoWidth confirms a real
      // frame has arrived.
      if (detector && video && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        try {
          const found = await detector.detector.detect(video);
          // detect() is awaited, so the scanner can have been closed meanwhile.
          // Without this the closing frame still reported a read.
          if (stopped) return;

          framesRead += 1;
          if (framesRead === 1) armTimer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
          if (framesRead % 10 === 0 && videoRef.current) {
            setDiagnostics(
              `${detector?.kind === "loaded" ? "Loaded reader" : "Built-in reader"} · ` +
              `${videoRef.current.videoWidth}×${videoRef.current.videoHeight} · ${framesRead} frames`,
            );
          }

          const aimed = pickAimed(found, video.videoWidth, video.videoHeight);
          const settled = gate(aimed?.rawValue, Date.now());
          if (settled) {
            setLastValue(settled);
            onScanRef.current(settled);
          }
        } catch (e) {
          // Frames that simply hold no code never reach here. This is a real
          // failure, and repeating it silently is how a scanner looks like it
          // is working while reading nothing.
          if (!stopped) setError(`The scanner could not read the camera: ${(e as Error)?.message || e}`);
          return;
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

        // A higher resolution than the default: the bars on a Code 39 label are
        // narrow, and a low-resolution frame cannot resolve them. 4:3 because
        // that is the sensor's own shape; a 16:9 stream is cut from it, which
        // narrows the view and reads as being zoomed in.
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1440 },
            aspectRatio: { ideal: 4 / 3 },
          },
        });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        await zoomAllTheWayOut(s);
        if (stopped) return;
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
      setArmed(false);
      setLastValue("");
      setDiagnostics("");
      if (armTimer) clearTimeout(armTimer);
      cancelAnimationFrame(frame);
      // Leaving the track running keeps the phone's camera light on.
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  const syncAspect = () => {
    const video = videoRef.current;
    if (video?.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
  };

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
            <div
              className="relative mx-auto overflow-hidden rounded-lg border bg-black"
              style={{ aspectRatio: aspect, width: `min(100%, calc(60vh * ${aspect}))` }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 h-full w-full object-contain"
                onLoadedMetadata={syncAspect}
                onResize={syncAspect}
              />
              <div
                className={`pointer-events-none absolute rounded-lg border-2 ${armed ? "border-white" : "border-white/40"}`}
                style={{ inset: `${AIM_MARGIN * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Camera className="h-3 w-3" />
              {!ready
                ? "Starting the camera…"
                : !armed
                  ? "Get ready. Line up the code inside the box."
                  : "Scanning. Hold the code inside the box for a moment."}
            </p>
            {lastValue && (
              <p className="font-mono text-xs">Last read: {lastValue}</p>
            )}
            {diagnostics && (
              <p className="text-[10px] text-muted-foreground">{diagnostics}</p>
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

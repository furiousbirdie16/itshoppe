import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { DocumentData, getPDFDataURL, downloadPDF } from "@/lib/pdf";

interface DocumentPreviewProps {
  open: boolean;
  onClose: () => void;
  data: DocumentData | null;
}

export function DocumentPreview({ open, onClose, data }: DocumentPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open && data) {
      try {
        const url = getPDFDataURL(data);
        setPdfUrl(url);
      } catch {
        setPdfUrl(null);
      }
    } else {
      setPdfUrl(null);
    }
  }, [open, data]);

  if (!data) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 pr-14 border-b flex flex-row items-center justify-between gap-2 shrink-0 space-y-0 text-left">
          <DialogTitle className="text-base font-semibold truncate min-w-0 flex-1">{data.number} — Preview</DialogTitle>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => downloadPDF(data)}
              className="rounded-lg h-8 px-2 sm:px-3 text-xs font-medium"
            >
              <Download className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Download PDF</span>
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 bg-muted/50 overflow-auto p-4">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="w-full h-full rounded-lg border bg-card shadow-sm"
              title="PDF Preview"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Generating preview...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

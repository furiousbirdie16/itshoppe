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
        <DialogHeader className="px-5 py-3 border-b flex flex-row items-center justify-between shrink-0">
          <DialogTitle className="text-base font-semibold">{data.number} — Preview</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => downloadPDF(data)}
              className="rounded-lg h-8 px-3 text-xs font-medium"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download PDF
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

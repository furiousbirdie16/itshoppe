import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DocumentData, getPDFBlobURL, downloadPDF } from "@/lib/pdf";
import { getDocumentLogo } from "@/lib/document-logo";
import { getCompanyContact } from "@/lib/company-contact";

interface DocumentPreviewProps {
  open: boolean;
  onClose: () => void;
  data: DocumentData | null;
}

export function DocumentPreview({ open, onClose, data }: DocumentPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // Wait for it before drawing, or the preview shows the built-in logo and
  // then swaps.
  const { data: logo, isFetched: logoReady } = useQuery({
    queryKey: ["document-logo"],
    queryFn: getDocumentLogo,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const { data: contact, isFetched: contactReady } = useQuery({
    queryKey: ["company-contact"],
    queryFn: getCompanyContact,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (open && data && logoReady && contactReady) {
      try {
        const url = getPDFBlobURL(data, logo, contact);
        setPdfUrl(url);
        // Freed a minute later rather than at once: a tab opened from it may
        // still be loading when the preview closes.
        return () => { setTimeout(() => URL.revokeObjectURL(url), 60_000); };
      } catch {
        setPdfUrl(null);
      }
    } else {
      setPdfUrl(null);
    }
  }, [open, data, logo, logoReady, contact, contactReady]);

  if (!data) return null;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 pr-14 border-b flex flex-row items-center justify-between gap-2 shrink-0 space-y-0 text-left">
          <DialogTitle className="text-base font-semibold truncate min-w-0 flex-1">{data.number} — Preview</DialogTitle>
          <div className="flex items-center gap-2 shrink-0">
            {/* Phones cannot show a PDF inside the page, so this is how the
                document is read there. A real link, so the tab opens from the
                tap itself and no pop-up blocker steps in. */}
            {pdfUrl && (
              <Button asChild size="sm" variant="outline" className="rounded-lg h-8 px-2 sm:px-3 text-xs font-medium">
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Open in new tab</span>
                  <span className="sm:hidden ml-1">Open</span>
                </a>
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => downloadPDF(data, logo, contact)}
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

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface DocumentData {
  type: "purchase_order" | "quotation" | "invoice";
  number: string;
  date: string;
  status: string;
  notes?: string;
  recipientLabel: string;
  recipientName: string;
  recipientContact?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  extraFields?: { label: string; value: string }[];
  items: {
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  totalAmount: number;
}

const BLK = [0, 0, 0] as [number, number, number];
const GRY = [100, 100, 100] as [number, number, number];
const LGRY = [200, 200, 200] as [number, number, number];
const WHT = [255, 255, 255] as [number, number, number];
const TBLHD = [40, 40, 40] as [number, number, number];
const ALTROW = [248, 248, 248] as [number, number, number];

const COMPANY_NAME = "8IT SHOPPE";
const COMPANY_ADDRESS_1 = "628 Honorio Lopez Blvd.";
const COMPANY_ADDRESS_2 = "Tondo, Manila";

const LOGO_BASE64 = "data:image/png;base64,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";

const PESO = "PHP ";
function fmt(n: number): string {
  return PESO + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDocTitle(type: DocumentData["type"]): string {
  switch (type) {
    case "purchase_order": return "PURCHASE ORDER";
    case "quotation": return "QUOTATION";
    case "invoice": return "INVOICE";
  }
}

export function generateDocumentPDF(data: DocumentData): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 20;
  const mr = 20;
  let y = 18;

  // ── Logo ──
  try {
    doc.addImage(LOGO_BASE64, "PNG", ml, y - 6, 12, 12);
  } catch {
    // fallback if image fails
  }

  // ── Company Info (next to logo) ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BLK);
  doc.text(COMPANY_NAME, ml + 15, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRY);
  doc.text(COMPANY_ADDRESS_1, ml + 15, y);
  y += 4;
  doc.text(COMPANY_ADDRESS_2, ml + 15, y);

  // ── Document Title (top-right) ──
  const title = getDocTitle(data.type);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...BLK);
  doc.text(title, pw - mr, 36, { align: "right" });

  y = 50;

  // ── Bill To / Recipient (left) ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BLK);
  doc.text(data.recipientLabel === "Supplier" ? "Ship To" : "Bill To", ml, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BLK);
  doc.text(data.recipientName || "—", ml, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRY);
  if (data.recipientAddress) {
    const addrLines = doc.splitTextToSize(data.recipientAddress, 80);
    doc.text(addrLines, ml, y);
    y += addrLines.length * 4;
  }
  const contactParts: string[] = [];
  if (data.recipientContact) contactParts.push(data.recipientContact);
  if (data.recipientEmail) contactParts.push(data.recipientEmail);
  if (data.recipientPhone) contactParts.push(data.recipientPhone);
  if (contactParts.length) {
    contactParts.forEach((p) => {
      doc.text(p, ml, y);
      y += 4;
    });
  }

  // ── Document details table (right side) ──
  const detailX = pw - mr - 70;
  let dy = 50;

  const detailRows: [string, string][] = [];
  const numLabel = data.type === "invoice" ? "Invoice #"
    : data.type === "quotation" ? "Quotation #"
    : "PO #";
  detailRows.push([numLabel, data.number]);

  const dateLabel = data.type === "invoice" ? "Invoice date"
    : data.type === "quotation" ? "Quotation date"
    : "Order date";
  detailRows.push([dateLabel, data.date]);

  if (data.extraFields) {
    data.extraFields.forEach((f) => detailRows.push([f.label, f.value]));
  }

  detailRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BLK);
    doc.text(label, detailX, dy);
    doc.setFont("helvetica", "normal");
    doc.text(value, pw - mr, dy, { align: "right" });
    dy += 6;
  });

  y = Math.max(y, dy) + 10;

  // ── Items Table ──
  autoTable(doc, {
    startY: y,
    margin: { left: ml, right: mr },
    head: [["QTY", "Description", "Unit Price", "Amount"]],
    body: data.items.map((item) => [
      item.quantity.toFixed(2),
      item.name + (item.sku ? `  (${item.sku})` : ""),
      fmt(item.unitPrice),
      fmt(item.total),
    ]),
    headStyles: {
      fillColor: TBLHD,
      textColor: WHT,
      fontSize: 8.5,
      fontStyle: "bold",
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
      textColor: BLK,
    },
    alternateRowStyles: {
      fillColor: ALTROW,
    },
    columnStyles: {
      0: { cellWidth: 18, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 32, halign: "right" },
      3: { cellWidth: 32, halign: "right", fontStyle: "bold" },
    },
    theme: "plain",
    styles: {
      lineColor: LGRY,
      lineWidth: 0.2,
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || y + 40;
  y = finalY + 2;

  // ── Totals ──
  const totLabelX = pw - mr - 65;
  const totValX = pw - mr;

  doc.setDrawColor(...LGRY);
  doc.setLineWidth(0.3);
  doc.line(totLabelX - 4, y, totValX, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BLK);
  doc.text("Subtotal", totLabelX, y);
  doc.text(fmt(data.totalAmount), totValX, y, { align: "right" });
  y += 8;

  doc.setFillColor(...TBLHD);
  doc.rect(totLabelX - 4, y - 4.5, 69, 11, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...WHT);
  doc.text("Total (PHP)", totLabelX, y + 1.5);
  doc.text(fmt(data.totalAmount), totValX - 2, y + 1.5, { align: "right" });

  // ── Notes / Terms ──
  if (data.notes && data.notes.trim()) {
    y += 24;

    if (y > ph - 40) {
      doc.addPage();
      y = 20;
    }

    const notesLabel = data.type === "invoice"
      ? "Terms and Conditions"
      : data.type === "quotation"
        ? "Terms, Warranty & Conditions"
        : "Notes";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BLK);
    doc.text(notesLabel, ml, y);
    y += 5;

    doc.setDrawColor(...BLK);
    doc.setLineWidth(0.5);
    doc.line(ml, y, ml + 40, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRY);
    const splitNotes = doc.splitTextToSize(data.notes, pw - ml - mr);
    doc.text(splitNotes, ml, y);
  }

  // ── Footer ──
  doc.setDrawColor(...LGRY);
  doc.setLineWidth(0.2);
  doc.line(ml, ph - 14, pw - mr, ph - 14);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRY);
  doc.text(`Generated by ${COMPANY_NAME}  •  All amounts in Philippine Peso (PHP)`, ml, ph - 9);
  doc.text("Page 1", pw - mr, ph - 9, { align: "right" });

  return doc;
}

export function downloadPDF(data: DocumentData) {
  const doc = generateDocumentPDF(data);
  doc.save(`${data.number}.pdf`);
}

export function getPDFDataURL(data: DocumentData): string {
  const doc = generateDocumentPDF(data);
  return doc.output("dataurlstring");
}

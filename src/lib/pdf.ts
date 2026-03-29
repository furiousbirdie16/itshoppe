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

const C = {
  primary: [44, 62, 147] as [number, number, number],
  primaryLight: [236, 239, 250] as [number, number, number],
  dark: [17, 24, 39] as [number, number, number],
  gray: [107, 114, 128] as [number, number, number],
  lightGray: [243, 244, 246] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  border: [229, 231, 235] as [number, number, number],
  green: [22, 163, 74] as [number, number, number],
  amber: [217, 119, 6] as [number, number, number],
};

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
  const m = 18;
  const cw = pw - m * 2;
  let y = m;

  // ── Top accent line ──
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, pw, 3, "F");

  y = 14;

  // ── Company name ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...C.dark);
  doc.text("ERP System", m, y);

  // ── Document type badge ──
  const title = getDocTitle(data.type);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.primary);
  const tw = doc.getTextWidth(title);
  const badgeX = pw - m - tw - 8;
  doc.setFillColor(...C.primaryLight);
  doc.roundedRect(badgeX, y - 5.5, tw + 8, 8, 1.5, 1.5, "F");
  doc.text(title, badgeX + 4, y);

  y += 10;

  // ── Document number & date ──
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.gray);
  doc.text(`No: ${data.number}`, m, y);
  doc.text(`Date: ${data.date}`, m + 60, y);

  // Status on the right
  const statusText = data.status.replace(/_/g, " ").toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const isPositive = ["paid", "received", "accepted", "confirmed"].includes(data.status);
  doc.setTextColor(...(isPositive ? C.green : C.amber));
  doc.text(statusText, pw - m, y, { align: "right" });

  y += 6;
  // Thin separator
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.3);
  doc.line(m, y, pw - m, y);

  y += 8;

  // ── Recipient card ──
  doc.setFillColor(...C.lightGray);
  doc.roundedRect(m, y, cw, 30, 2, 2, "F");

  const ry = y + 6;
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.gray);
  doc.text(data.recipientLabel.toUpperCase(), m + 5, ry);

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.dark);
  doc.text(data.recipientName || "—", m + 5, ry + 7);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.gray);

  const infoParts: string[] = [];
  if (data.recipientContact) infoParts.push(data.recipientContact);
  if (data.recipientEmail) infoParts.push(data.recipientEmail);
  if (data.recipientPhone) infoParts.push(data.recipientPhone);
  if (infoParts.length) doc.text(infoParts.join("  |  "), m + 5, ry + 13);
  if (data.recipientAddress) doc.text(data.recipientAddress, m + 5, ry + 18);

  // Extra fields on right side of card
  if (data.extraFields?.length) {
    let efY = ry;
    data.extraFields.forEach((f) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.gray);
      doc.text(f.label.toUpperCase(), pw - m - 5, efY, { align: "right" });
      efY += 4;
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...C.dark);
      doc.text(f.value, pw - m - 5, efY, { align: "right" });
      efY += 6;
    });
  }

  y += 38;

  // ── Items table ──
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m },
    head: [["#", "Description", "SKU", "Qty", "Unit Price", "Amount"]],
    body: data.items.map((item, i) => [
      (i + 1).toString(),
      item.name,
      item.sku || "—",
      item.quantity.toString(),
      fmt(item.unitPrice),
      fmt(item.total),
    ]),
    headStyles: {
      fillColor: C.dark,
      textColor: C.white,
      fontSize: 7.5,
      fontStyle: "bold",
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
    },
    bodyStyles: {
      fontSize: 8.5,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      textColor: C.dark,
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 24, halign: "center", textColor: C.gray, fontStyle: "italic", fontSize: 7.5 },
      3: { cellWidth: 14, halign: "center" },
      4: { cellWidth: 30, halign: "right" },
      5: { cellWidth: 30, halign: "right", fontStyle: "bold" },
    },
    theme: "plain",
    styles: {
      lineColor: C.border,
      lineWidth: 0.2,
      overflow: "linebreak",
    },
    didDrawPage: () => {
      // Re-draw top accent on new pages
      doc.setFillColor(...C.primary);
      doc.rect(0, 0, pw, 3, "F");
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || y + 40;
  y = finalY + 6;

  // ── Totals section ──
  const totW = 72;
  const totX = pw - m - totW;

  // Subtotal
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.gray);
  doc.text("Subtotal", totX + 4, y);
  doc.setTextColor(...C.dark);
  doc.text(fmt(data.totalAmount), pw - m - 4, y, { align: "right" });

  y += 4;
  doc.setDrawColor(...C.border);
  doc.line(totX, y, pw - m, y);
  y += 6;

  // Total highlight
  doc.setFillColor(...C.primary);
  doc.roundedRect(totX, y - 4.5, totW, 11, 2, 2, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.white);
  doc.text("TOTAL", totX + 4, y + 2);
  doc.text(fmt(data.totalAmount), pw - m - 4, y + 2, { align: "right" });

  y += 16;

  // ── Notes / Terms section ──
  if (data.notes && data.notes.trim()) {
    // Check if we need a new page
    if (y > ph - 50) {
      doc.addPage();
      doc.setFillColor(...C.primary);
      doc.rect(0, 0, pw, 3, "F");
      y = 16;
    }

    const notesLabel = data.type === "invoice"
      ? "PAYMENT TERMS & CONDITIONS"
      : data.type === "quotation"
        ? "TERMS, WARRANTY & CONDITIONS"
        : "NOTES";

    doc.setFillColor(...C.lightGray);
    const splitNotes = doc.splitTextToSize(data.notes, cw - 10);
    const notesH = Math.max(20, splitNotes.length * 4.5 + 14);
    doc.roundedRect(m, y, cw, notesH, 2, 2, "F");

    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.primary);
    doc.text(notesLabel, m + 5, y + 6);

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.dark);
    doc.text(splitNotes, m + 5, y + 12);
  }

  // ── Footer ──
  doc.setDrawColor(...C.border);
  doc.line(m, ph - 14, pw - m, ph - 14);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.gray);
  doc.text("Generated by ERP System  •  All amounts in Philippine Peso (PHP)", m, ph - 9);
  doc.text(`Page 1`, pw - m, ph - 9, { align: "right" });

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

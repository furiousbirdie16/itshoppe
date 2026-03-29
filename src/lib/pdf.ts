import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface DocumentData {
  type: "purchase_order" | "quotation" | "invoice";
  number: string;
  date: string;
  status: string;
  notes?: string;
  // Recipient
  recipientLabel: string; // "Supplier" or "Customer"
  recipientName: string;
  recipientContact?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  // Extra fields
  extraFields?: { label: string; value: string }[];
  // Line items
  items: {
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  totalAmount: number;
}

const COLORS = {
  primary: [59, 91, 219] as [number, number, number],
  dark: [30, 35, 50] as [number, number, number],
  muted: [120, 130, 150] as [number, number, number],
  light: [245, 247, 250] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  border: [220, 225, 235] as [number, number, number],
};

function getDocTitle(type: DocumentData["type"]): string {
  switch (type) {
    case "purchase_order": return "Purchase Order";
    case "quotation": return "Quotation";
    case "invoice": return "Invoice";
  }
}

export function generateDocumentPDF(data: DocumentData): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // === Header bar ===
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 40, "F");

  // Company name
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("ERP System", margin, 18);

  // Document type
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(getDocTitle(data.type).toUpperCase(), margin, 28);

  // Document number (right side)
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(data.number, pageWidth - margin, 18, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${data.date}`, pageWidth - margin, 28, { align: "right" });

  y = 52;

  // === Recipient & Details Section ===
  doc.setFillColor(...COLORS.light);
  doc.roundedRect(margin, y, contentWidth, 38, 2, 2, "F");

  // Left: Recipient
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(data.recipientLabel.toUpperCase(), margin + 6, y + 8);

  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(data.recipientName || "—", margin + 6, y + 16);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.muted);
  const contactParts: string[] = [];
  if (data.recipientContact) contactParts.push(data.recipientContact);
  if (data.recipientEmail) contactParts.push(data.recipientEmail);
  if (data.recipientPhone) contactParts.push(data.recipientPhone);
  if (contactParts.length > 0) {
    doc.text(contactParts.join("  ·  "), margin + 6, y + 23);
  }
  if (data.recipientAddress) {
    doc.text(data.recipientAddress, margin + 6, y + 30);
  }

  // Right: Status + extra fields
  const rightX = pageWidth - margin - 6;
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("STATUS", rightX, y + 8, { align: "right" });

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.primary);
  doc.text(data.status.replace(/_/g, " ").toUpperCase(), rightX, y + 16, { align: "right" });

  if (data.extraFields) {
    let extraY = y + 24;
    data.extraFields.forEach((f) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COLORS.muted);
      doc.text(`${f.label}: ${f.value}`, rightX, extraY, { align: "right" });
      extraY += 5;
    });
  }

  y += 48;

  // === Items Table ===
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["#", "Item", "SKU", "Qty", "Unit Price", "Total"]],
    body: data.items.map((item, i) => [
      (i + 1).toString(),
      item.name,
      item.sku || "—",
      item.quantity.toString(),
      `$${item.unitPrice.toFixed(2)}`,
      `$${item.total.toFixed(2)}`,
    ]),
    headStyles: {
      fillColor: COLORS.dark,
      textColor: COLORS.white,
      fontSize: 8,
      fontStyle: "bold",
      cellPadding: 4,
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: 4,
      textColor: COLORS.dark,
    },
    alternateRowStyles: {
      fillColor: COLORS.light,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 28, fontStyle: "italic" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 28, halign: "right", fontStyle: "bold" },
    },
    theme: "plain",
    styles: {
      lineColor: COLORS.border,
      lineWidth: 0.3,
    },
  });

  // Get final Y after table
  const finalY = (doc as any).lastAutoTable?.finalY || y + 40;
  y = finalY + 8;

  // === Totals ===
  const totalsX = pageWidth - margin;
  doc.setDrawColor(...COLORS.border);
  doc.line(pageWidth - margin - 70, y, totalsX, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.muted);
  doc.text("Subtotal", totalsX - 40, y);
  doc.setTextColor(...COLORS.dark);
  doc.text(`$${data.totalAmount.toFixed(2)}`, totalsX, y, { align: "right" });

  y += 10;
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(pageWidth - margin - 70, y - 5, 70, 12, 1.5, 1.5, "F");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.white);
  doc.text("TOTAL", totalsX - 40, y + 2);
  doc.text(`$${data.totalAmount.toFixed(2)}`, totalsX - 4, y + 2, { align: "right" });

  // === Notes ===
  if (data.notes) {
    y += 22;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.muted);
    doc.text("NOTES", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(9);
    const splitNotes = doc.splitTextToSize(data.notes, contentWidth);
    doc.text(splitNotes, margin, y);
  }

  // === Footer ===
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...COLORS.border);
  doc.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.muted);
  doc.text("Generated by ERP System", margin, pageHeight - 10);
  doc.text(`Page 1 of 1`, pageWidth - margin, pageHeight - 10, { align: "right" });

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

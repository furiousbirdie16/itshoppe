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

const COMPANY_NAME = "IT SHOPPE";
const COMPANY_ADDRESS_1 = "628 Honorio Lopez Blvd.";
const COMPANY_ADDRESS_2 = "Tondo, Manila";

const LOGO_DATA = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAyADIDAREAAhEBAxEB/8QAGAABAAMBAAAAAAAAAAAAAAAAAAQGCAn/xAAkEAAABgIDAAIDAQAAAAAAAAAAAQIDBAUGBwgREhMhFCIxJP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwDqmAAAAAAAAAAAAAAAAAAMicyOTu2NM7DoMK1vNwyvZm4xZ5DKk5FGkvE4qKovLDXwqLpSi7Iuy67/AKZEA0Ho3NrfZOnML2Bfxo0exyGjh2UpqN38SHXWkqUSOzM/PZ/X2YC8AAAAAADK/KzR+9862VTZ7pqNiUxDeHXOJzmLyY7HNCZ/kjdbNtCjUZJL6Iz67L+AK7J4cbAscGxzF7K0gOO0GFYzRM/FaSWW25sOcbk5afBF+q4y1Nkoy7PvoyL6MBH3XxN3LlGyLq51nOr66omVf4+C7KyGUlUVtNauMhDbaW/TZ/IaTMjcW2fXo0+gELJ+JPIOZf31jYZZDzmLZxpUeAmyu3qxUGW7Bhss2BIjNePbK2HiJJERmSiV36UoBHLgjt+VTTp1puJbl/NuSN1CXHjjvwVT2HluPqNXp5ZNMq8tdJIjWpPro+wFl11xG2XrTfFLlJZQrJ8TrGGUpfnWimn2V/6FOeYxtrLwSnkEhJOl+qCIzPoBsIAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=";

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
    doc.addImage(LOGO_DATA, "JPEG", ml, y - 6, 12, 12);
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
      item.name,
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

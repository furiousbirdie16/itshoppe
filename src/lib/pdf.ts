import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fitLogo, type DocumentLogo } from "./document-logo";
import type { CompanyContact } from "./company-contact";

export interface DocumentData {
  type: "purchase_order" | "quotation" | "invoice";
  number: string;
  date: string;
  status: string;
  currencyCode?: string;
  currencySymbol?: string;
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
    unitPrice: number | null;
    total: number | null;
  }[];
  totalAmount: number;
  /** Printed under the "Prepared by" signature line on a quotation. */
  preparedBy?: string;
}

type RGB = [number, number, number];
// Graphite + Teal, the app's palette: one teal accent, greys for everything else.
const INK: RGB = [17, 20, 24];
const GRY: RGB = [92, 99, 107];
const RULE: RGB = [230, 232, 235];
const TEAL: RGB = [15, 118, 110];
const PALE: RGB = [230, 242, 241];
const PESO = "PHP ";

const COMPANY_NAME = "IT SHOPPE";
const COMPANY_ADDRESS_1 = "628 Honorio Lopez Blvd.";
const COMPANY_ADDRESS_2 = "Tondo, Manila";


const LOGO_DATA = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAyADIDAREAAhEBAxEB/8QAGAABAAMBAAAAAAAAAAAAAAAAAAQGCAn/xAAkEAAABgIDAAIDAQAAAAAAAAAAAQIDBAUGBwgREhMhFCIxJP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwDqmAAAAAAAAAAAAAAAAAAMicyOTu2NM7DoMK1vNwyvZm4xZ5DKk5FGkvE4qKovLDXwqLpSi7Iuy67/AKZEA0Ho3NrfZOnML2Bfxo0exyGjh2UpqN38SHXWkqUSOzM/PZ/X2YC8AAAAAADK/KzR+9862VTZ7pqNiUxDeHXOJzmLyY7HNCZ/kjdbNtCjUZJL6Iz67L+AK7J4cbAscGxzF7K0gOO0GFYzRM/FaSWW25sOcbk5afBF+q4y1Nkoy7PvoyL6MBH3XxN3LlGyLq51nOr66omVf4+C7KyGUlUVtNauMhDbaW/TZ/IaTMjcW2fXo0+gELJ+JPIOZf31jYZZDzmLZxpUeAmyu3qxUGW7Bhss2BIjNePbK2HiJJERmSiV36UoBHLgjt+VTTp1puJbl/NuSN1CXHjjvwVT2HluPqNXp5ZNMq8tdJIjWpPro+wFl11xG2XrTfFLlJZQrJ8TrGGUpfnWimn2V/6FOeYxtrLwSnkEhJOl+qCIzPoBsIAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=";

// Amounts in pesos are written with a drawn peso sign: jsPDF's built-in
// Helvetica has no ₱ glyph, so the sign is a P with its two bars ruled across.
function moneyText(n: number, symbol: string): string {
  const digits = n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol === PESO ? "P" + digits : symbol + digits;
}

function fmt(n: number, symbol = PESO): string {
  return symbol === PESO ? "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : moneyText(n, symbol);
}

/**
 * Write an amount right-aligned at (xRight, baseline). With the peso as the
 * currency, the leading P gets its two bars, so it reads as ₱.
 */
function drawAmount(doc: jsPDF, n: number, symbol: string, xRight: number, baseline: number, color: RGB) {
  const text = moneyText(n, symbol);
  doc.setTextColor(...color);
  doc.text(text, xRight, baseline, { align: "right" });
  if (symbol !== PESO) return;
  const size = doc.getFontSize() * 0.3528; // pt → mm
  const capH = size * 0.718;
  const pLeft = xRight - doc.getTextWidth(text);
  const pW = doc.getTextWidth("P");
  doc.setDrawColor(...color);
  doc.setLineWidth(size * (doc.getFont().fontStyle === "bold" ? 0.085 : 0.065));
  for (const f of [0.6, 0.78]) {
    doc.line(pLeft - pW * 0.14, baseline - capH * f, pLeft + pW * 0.9, baseline - capH * f);
  }
}

/** 1 rather than 1.00; 2.5 stays 2.5. */
function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function getDocTitle(type: DocumentData["type"]): string {
  switch (type) {
    case "purchase_order": return "PURCHASE ORDER";
    case "quotation": return "QUOTATION";
    case "invoice": return "INVOICE";
  }
}

// Printed under the terms of every quotation unless the notes already say it.
const QUOTATION_STANDARD_TERMS = ["Prices are subject to stock availability."];

export function generateDocumentPDF(data: DocumentData, logo?: DocumentLogo | null, contact?: CompanyContact | null): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 20;
  const mr = 20;
  const currencyCode = data.currencyCode ?? "PHP";
  const currencySymbol = data.currencySymbol ?? (currencyCode === "PHP" ? PESO : `${currencyCode} `);
  let y = 18;

  // ── Logo ──
  // The uploaded one keeps its own shape inside a 30 × 14 mm box; the
  // company name moves along to sit beside however wide it came out.
  let logoW = 12;
  try {
    if (logo) {
      const { w, h } = fitLogo(logo.width, logo.height, 30, 14);
      doc.addImage(logo.dataUrl, logo.format, ml, y - 7 + (14 - h) / 2, w, h);
      logoW = w;
    } else {
      doc.addImage(LOGO_DATA, "JPEG", ml, y - 6, 12, 12);
    }
  } catch {
    // fallback if image fails
  }
  const textX = ml + logoW + 3;

  // ── Company Info (next to logo) ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(COMPANY_NAME, textX, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRY);
  doc.text(COMPANY_ADDRESS_1, textX, y);
  y += 4;
  doc.text(COMPANY_ADDRESS_2, textX, y);
  // Phone, email and TIN from Settings, on what goes to customers: quotations
  // and invoices. A blank one is left off.
  if (contact && (data.type === "quotation" || data.type === "invoice")) {
    const reach = [contact.phone, contact.email].filter(Boolean).join("  ·  ");
    if (reach) {
      y += 4;
      doc.text(reach, textX, y);
    }
    if (contact.tin) {
      y += 4;
      doc.text(`TIN ${contact.tin}`, textX, y);
    }
  }

  // ── Document Title (top-right) ──
  // Teal and a size down: it no longer out-shouts the company name.
  const title = getDocTitle(data.type);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...TEAL);
  doc.text(title, pw - mr, 36, { align: "right" });

  // A thin teal rule across the page closes the header.
  const ruleY = Math.max(41, y + 4);
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.5);
  doc.line(ml, ruleY, pw - mr, ruleY);

  y = ruleY + 9;
  const topOfDetails = y;

  // ── Bill To / Recipient (left) ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRY);
  doc.text(data.recipientLabel === "Supplier" ? "Ship To" : "Bill To", ml, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
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

  // ── Document details (right side) ──
  // Labels in grey, values in ink: the values are what the reader is after.
  const detailX = pw - mr - 70;
  let dy = topOfDetails;

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
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRY);
    doc.text(label, detailX, dy);
    doc.setTextColor(...INK);
    doc.text(value, pw - mr, dy, { align: "right" });
    dy += 6;
  });

  y = Math.max(y, dy) + 8;

  // ── Items Table ──
  // Note: SKU is intentionally omitted from purchase orders per business preference
  // Pale teal header, no vertical lines or zebra rows: only a light rule
  // under each row. Money cells are drawn by hand so the peso sign gets its bars.
  const moneyCols = new Set([2, 3]);
  const cellMoney = new WeakMap<object, string>();
  autoTable(doc, {
    startY: y,
    margin: { left: ml, right: mr },
    head: [["Qty", "Description", "Unit price", "Amount"]],
    body: data.items.map((item) => [
      qty(item.quantity),
      item.name,
      item.unitPrice == null ? "" : moneyText(item.unitPrice, currencySymbol),
      item.total == null ? "" : moneyText(item.total, currencySymbol),
    ]),
    headStyles: {
      fillColor: PALE,
      textColor: TEAL,
      fontSize: 8.5,
      fontStyle: "bold",
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: { top: 3.2, bottom: 3.2, left: 4, right: 4 },
      textColor: INK,
      valign: "middle",
    },
    columnStyles: {
      0: { cellWidth: 20, halign: "right" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 32, halign: "right" },
      3: { cellWidth: 34, halign: "right", fontStyle: "bold" },
    },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index !== 1) h.cell.styles.halign = "right";
    },
    willDrawCell: (h) => {
      // Keep the text for drawAmount; autotable must not print it too.
      if (h.section === "body" && moneyCols.has(h.column.index) && currencySymbol === PESO) {
        cellMoney.set(h.cell, h.cell.text.join(""));
        h.cell.text = [];
      }
    },
    didDrawCell: (h) => {
      if (h.section !== "body") return;
      const money = cellMoney.get(h.cell);
      if (money) {
        const n = Number(money.slice(1).replace(/,/g, ""));
        doc.setFont("helvetica", h.column.index === 3 ? "bold" : "normal");
        doc.setFontSize(9);
        const baseline = h.cell.y + h.cell.height / 2 + 9 * 0.3528 * 0.36;
        drawAmount(doc, n, currencySymbol, h.cell.x + h.cell.width - 4, baseline, INK);
      }
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.25);
      doc.line(h.cell.x, h.cell.y + h.cell.height, h.cell.x + h.cell.width, h.cell.y + h.cell.height);
    },
    theme: "plain",
  });

  const finalY = (doc as any).lastAutoTable?.finalY || y + 40;
  y = finalY + 6;

  // ── Totals ──
  const totLabelX = pw - mr - 65;
  const totValX = pw - mr;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRY);
  doc.text("Subtotal", totLabelX, y);
  drawAmount(doc, data.totalAmount, currencySymbol, totValX - 3, y, INK);
  y += 7;

  // The total is the first thing the eye should find: pale teal, larger, teal figure.
  doc.setFillColor(...PALE);
  doc.rect(totLabelX - 4, y - 5, 69, 13, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEAL);
  doc.text(`Total (${currencyCode})`, totLabelX, y + 2.5);
  doc.setFontSize(13);
  drawAmount(doc, data.totalAmount, currencySymbol, totValX - 3, y + 2.8, TEAL);

  // ── Notes / Terms ──
  const noteText = (data.notes || "").trim();
  const extraTerms = data.type === "quotation"
    ? QUOTATION_STANDARD_TERMS.filter((t) => !noteText.toLowerCase().includes(t.toLowerCase().replace(/\.$/, "")))
    : [];
  const termsText = [noteText, ...extraTerms].filter(Boolean).join("\n");
  if (termsText) {
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
    doc.setTextColor(...INK);
    doc.text(notesLabel, ml, y);
    y += 3;

    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(ml, y, pw - mr, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRY);
    const splitNotes = doc.splitTextToSize(termsText, pw - ml - mr);
    doc.text(splitNotes, ml, y);
    y += splitNotes.length * 4;
  }

  // ── Signatures (quotations) ──
  // "Prepared by" for us, "Conforme" for the customer to sign when they accept.
  if (data.type === "quotation") {
    let sy = ph - 42;
    if (y > sy - 14) {
      doc.addPage();
      sy = ph - 42;
    }
    const colW = 70;
    const cols: [number, string, string][] = [
      [ml, "Prepared by", data.preparedBy || ""],
      [pw - mr - colW, "Conforme", "Signature over printed name / date"],
    ];
    cols.forEach(([x, label, under]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...GRY);
      doc.text(label, x, sy);
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.line(x, sy + 14, x + colW, sy + 14);
      doc.setFontSize(8);
      doc.setTextColor(...(under === data.preparedBy ? INK : GRY));
      if (under) doc.text(under, x, sy + 18.5);
    });
  }

  // ── Footer ──
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(ml, ph - 14, pw - mr, ph - 14);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRY);
  doc.text(`Generated by ${COMPANY_NAME}  •  All amounts in ${currencyCode}`, ml, ph - 9);
  doc.text("Page 1", pw - mr, ph - 9, { align: "right" });

  return doc;
}

export function downloadPDF(data: DocumentData, logo?: DocumentLogo | null, contact?: CompanyContact | null) {
  const doc = generateDocumentPDF(data, logo, contact);
  doc.save(`${data.number}.pdf`);
}

export function getPDFDataURL(data: DocumentData, logo?: DocumentLogo | null, contact?: CompanyContact | null): string {
  const doc = generateDocumentPDF(data, logo, contact);
  return doc.output("dataurlstring");
}

/**
 * A blob: URL for the PDF. Unlike a data: URL, phones will open it in a new
 * tab (browsers block opening data: URLs as a page), and it is not a
 * multi-megabyte string held in the DOM.
 */
export function getPDFBlobURL(data: DocumentData, logo?: DocumentLogo | null, contact?: CompanyContact | null): string {
  return generateDocumentPDF(data, logo, contact).output("bloburl") as unknown as string;
}

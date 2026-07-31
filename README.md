# ITshoppe System

Build a modern web-based Inventory, Purchasing, and Sales System with a clean dashboard UI (similar to Stripe / Notion style). It must be fast, simple, and mobile responsive.

📦 INVENTORY MODULE

Create an inventory system with the following fields:

Item Name

SKU (unique)

Description

Quantity (auto-calculated, not manually editable)

Cost Price

Selling Price

Features:

Add / Edit / Delete items

Real-time stock tracking

Inventory movement logs (IN from receiving, OUT from invoices)

Optional low-stock alert

IMPORTANT:

Inventory quantity must only change from:

Purchase Order Receiving (adds stock)

Invoice Confirmation (deducts stock)

🏢 SUPPLIER MODULE

Supplier Name

Contact Person

Phone / Email

Address

Features:

Supplier list page

Each supplier shows linked Purchase Orders

View supplier transaction history

🧾 PURCHASE ORDER MODULE

Create Purchase Orders with:

Supplier selection

Item selection (searchable SKU dropdown)

Quantity + Cost

Features:

Create / Edit / Delete PO

Preview before saving

Export to PDF

CRITICAL LOGIC:

Creating a PO DOES NOT add stock

Add a "Receive" button

Only when clicked → items are added to inventory

Status system:

Draft

Sent

Partially Received (optional)

Received

👤 CUSTOMER MODULE

Customer Name

Contact Details

Address

Features:

Customer list page

View all quotations and invoices per customer

📄 QUOTATION MODULE

Create quotations with:

Customer selection

Item selection (SKU search)

Features:

Show live inventory quantity while selecting items

Preview quotation

Export to PDF

Save / Edit / Delete

ACTION:

Add button: Convert to Invoice (1 click)

💵 INVOICE MODULE

Same structure as quotation

Features:

Preview + Export PDF

CRITICAL LOGIC:

When invoice is confirmed, automatically:

Deduct inventory stock

Status:

Draft

Confirmed

Paid / Unpaid

🔗 SYSTEM LOGIC

Suppliers → linked to Purchase Orders

Customers → linked to Quotations and Invoices

Inventory updates only from:

PO Receiving (IN)

Invoice Confirmation (OUT)

Add global search:

Search by SKU, item, customer, supplier

📊 DASHBOARD

Include:

Total inventory value

Low stock items

Recent transactions (PO, Invoice)

🎨 UI/UX

Clean modern dashboard

Tables with filters and sorting

Modal forms for fast workflow

Dark + Light mode

📄 PDF OUTPUT

For:

Purchase Orders

Quotations

Invoices

Include:

Company logo

Header details

Item table

Totals

Notes section

⚙️ TECH (optional if Lovable asks)

React / Next.js frontend

Backend: Supabase / Node.js

Database: PostgreSQL

🎯 GOAL

Create a simple ERP-style system with this workflow:

Purchase Order → Receive → Inventory increases

Quotation → Convert → Invoice → Inventory decreases

No duplicate encoding. Everything is linked and automated.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://itshoppe.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ea53242e-e743-4f4e-b9ae-a0d32928a8d1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

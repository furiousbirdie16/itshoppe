import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ChildItemsConfig {
  /** Supabase table name to query */
  table: string;
  /** Foreign key column on the child table referencing the parent row */
  foreignKey: string;
  /** Property on parent row to use as the foreign key value (default: "id") */
  parentKey?: string;
  /** Supabase select string (e.g. "*, items(name, sku)") */
  select: string;
  /** Column mapping for child line — receives (childRow, parentRow) */
  columns: Record<string, (child: any, parent: any) => unknown>;
}

interface ExportButtonProps {
  data: any[];
  /** Parent column mapping: included on every row (parent and per-line) */
  columns: Record<string, (row: any) => unknown>;
  /** Date field accessor to filter by */
  dateField: (row: any) => string;
  /** File name prefix */
  fileName: string;
  /** When provided, the export fetches related line items and outputs one row per line */
  childItems?: ChildItemsConfig;
}

export default function ExportButton({ data, columns, dateField, fileName, childItems }: ExportButtonProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const buildParentRows = (filteredData: any[]) => {
    return filteredData.map(row => {
      const out: Record<string, unknown> = {};
      for (const [header, accessor] of Object.entries(columns)) {
        out[header] = accessor(row);
      }
      return out;
    });
  };

  const buildFlattenedRows = async (filteredData: any[]) => {
    if (!childItems || filteredData.length === 0) return buildParentRows(filteredData);
    const parentKey = childItems.parentKey || "id";
    const ids = filteredData.map(r => r[parentKey]).filter(Boolean);
    if (ids.length === 0) return buildParentRows(filteredData);

    const { data: lines, error } = await (supabase as any)
      .from(childItems.table)
      .select(childItems.select)
      .in(childItems.foreignKey, ids);

    if (error) {
      toast.error(`Failed to load line items: ${error.message}`);
      return buildParentRows(filteredData);
    }

    const grouped: Record<string, any[]> = {};
    (lines || []).forEach((l: any) => {
      const k = l[childItems.foreignKey];
      (grouped[k] ||= []).push(l);
    });

    const rows: Record<string, unknown>[] = [];
    const childKeys = Object.keys(childItems.columns);
    filteredData.forEach((parent: any) => {
      const parentValues: Record<string, unknown> = {};
      for (const [header, accessor] of Object.entries(columns)) {
        parentValues[header] = accessor(parent);
      }
      const myLines = grouped[parent[parentKey]] || [];
      if (myLines.length === 0) {
        const row: Record<string, unknown> = { ...parentValues };
        childKeys.forEach(k => { row[k] = ""; });
        rows.push(row);
        return;
      }
      myLines.forEach((line: any) => {
        const row: Record<string, unknown> = { ...parentValues };
        for (const [header, accessor] of Object.entries(childItems.columns)) {
          row[header] = accessor(line, parent);
        }
        rows.push(row);
      });
    });
    return rows;
  };

  const doExport = async (filteredData: any[]) => {
    if (filteredData.length === 0) {
      toast.error("Nothing to export for this range");
      return;
    }
    try {
      setLoading(true);
      const rows = await buildFlattenedRows(filteredData);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Export");
      XLSX.writeFile(wb, `${fileName}_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      setPopoverOpen(false);
      toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
    } finally {
      setLoading(false);
    }
  };

  const filterByDays = (days: number) => {
    const cutoff = subDays(new Date(), days).toISOString().split("T")[0];
    return data.filter(row => dateField(row) >= cutoff);
  };

  const filterByRange = () => {
    if (!dateRange.from || !dateRange.to) return data;
    const from = format(dateRange.from, "yyyy-MM-dd");
    const to = format(dateRange.to, "yyyy-MM-dd");
    return data.filter(row => {
      const d = dateField(row);
      return d >= from && d <= to;
    });
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-lg h-9 px-3 text-sm" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end" onInteractOutside={(e) => { if (customOpen || loading) e.preventDefault(); }}>
        {!customOpen ? (
          <div className="flex flex-col gap-1 min-w-[160px]">
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => doExport(filterByDays(7))} disabled={loading}>
              Last 7 days
            </Button>
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => doExport(filterByDays(30))} disabled={loading}>
              Last 30 days
            </Button>
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => doExport(data)} disabled={loading}>
              All records
            </Button>
            <hr className="my-1 border-border" />
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => setCustomOpen(true)} disabled={loading}>
              Custom dates…
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Calendar
              mode="range"
              selected={dateRange.from ? { from: dateRange.from, to: dateRange.to } : undefined}
              onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
              numberOfMonths={1}
              className={cn("p-3 pointer-events-auto")}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setCustomOpen(false); setDateRange({ from: undefined, to: undefined }); }} disabled={loading}>
                Back
              </Button>
              <Button size="sm" className="h-8 text-xs" disabled={!dateRange.from || !dateRange.to || loading} onClick={async () => { await doExport(filterByRange()); setCustomOpen(false); }}>
                Export
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

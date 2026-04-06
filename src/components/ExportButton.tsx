import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import * as XLSX from "xlsx";

interface ExportButtonProps {
  /** The full data array */
  data: Record<string, unknown>[];
  /** Column mapping: { sheetHeader: (row) => value } */
  columns: Record<string, (row: any) => unknown>;
  /** Date field accessor to filter by */
  dateField: (row: any) => string;
  /** File name prefix */
  fileName: string;
}

export default function ExportButton({ data, columns, dateField, fileName }: ExportButtonProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [popoverOpen, setPopoverOpen] = useState(false);

  const doExport = (filteredData: Record<string, unknown>[]) => {
    if (filteredData.length === 0) {
      return;
    }
    const rows = filteredData.map(row => {
      const out: Record<string, unknown> = {};
      for (const [header, accessor] of Object.entries(columns)) {
        out[header] = accessor(row);
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Export");
    XLSX.writeFile(wb, `${fileName}_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    setPopoverOpen(false);
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
        <Button variant="outline" size="sm" className="rounded-lg h-9 px-3 text-sm">
          <Download className="h-4 w-4 mr-1.5" /> Export
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end">
        {!customOpen ? (
          <div className="flex flex-col gap-1 min-w-[160px]">
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => doExport(filterByDays(7))}>
              Last 7 days
            </Button>
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => doExport(filterByDays(30))}>
              Last 30 days
            </Button>
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => doExport(data)}>
              All records
            </Button>
            <hr className="my-1 border-border" />
            <Button variant="ghost" size="sm" className="justify-start text-sm h-8" onClick={() => setCustomOpen(true)}>
              Custom dates…
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Calendar
              mode="range"
              selected={dateRange.from && dateRange.to ? { from: dateRange.from, to: dateRange.to } : undefined}
              onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
              numberOfMonths={1}
              className={cn("p-3 pointer-events-auto")}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setCustomOpen(false); setDateRange({ from: undefined, to: undefined }); }}>
                Back
              </Button>
              <Button size="sm" className="h-8 text-xs" disabled={!dateRange.from || !dateRange.to} onClick={() => { doExport(filterByRange()); setCustomOpen(false); }}>
                Export
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

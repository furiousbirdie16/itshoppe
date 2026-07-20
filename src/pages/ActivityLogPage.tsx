import { useQuery } from "@tanstack/react-query";
import { getActivityLogs } from "@/lib/activity-log";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search } from "lucide-react";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { ColumnDef, ColumnVisibilityMenu, useColumnPrefs } from "@/components/ColumnVisibility";

const actionColors: Record<string, string> = {
  created: "bg-success/10 text-success border-success/20",
  updated: "bg-primary/10 text-primary border-primary/20",
  deleted: "bg-destructive/10 text-destructive border-destructive/20",
  confirmed: "bg-warning/10 text-warning border-warning/20",
  reverted: "bg-muted text-muted-foreground border-muted",
  received: "bg-success/10 text-success border-success/20",
  converted: "bg-primary/10 text-primary border-primary/20",
};

function getActionColor(action: string) {
  const key = Object.keys(actionColors).find((k) => action.toLowerCase().includes(k));
  return key ? actionColors[key] : "bg-muted text-muted-foreground border-muted";
}

const COLUMNS: ColumnDef[] = [
  { key: "created_at", label: "When", defaultVisible: true },
  { key: "user_email", label: "Who", defaultVisible: true },
  { key: "action", label: "Action", defaultVisible: true },
  { key: "entity_type", label: "Module", defaultVisible: true },
  { key: "details", label: "Details", defaultVisible: true },
];

export default function ActivityLogPage() {
  const [search, setSearch] = useState("");
  const { data: logs, isLoading } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: getActivityLogs,
  });

  const { state, orderedColumns, visibleColumns, isVisible, toggle, move, reset } = useColumnPrefs("cols:activity-log", COLUMNS);

  const filtered = (logs || []).filter((log) => {
    const s = search.toLowerCase();
    return (
      !s ||
      log.user_email.toLowerCase().includes(s) ||
      log.action.toLowerCase().includes(s) ||
      log.entity_type.toLowerCase().includes(s) ||
      (log.entity_id && log.entity_id.toLowerCase().includes(s)) ||
      JSON.stringify(log.details).toLowerCase().includes(s)
    );
  });

  const { sort, toggle: sortToggle, sorted: sortedLogs } = useSort<any>(filtered, {
    created_at: (r) => r.created_at,
    user_email: (r) => r.user_email,
    action: (r) => r.action,
    entity_type: (r) => r.entity_type,
  });

  const heads: Record<string, JSX.Element> = {
    created_at: <SortableHeader key="h-created_at" sortKey="created_at" label="When" sort={sort} onToggle={sortToggle} />,
    user_email: <SortableHeader key="h-user_email" sortKey="user_email" label="Who" sort={sort} onToggle={sortToggle} />,
    action: <SortableHeader key="h-action" sortKey="action" label="Action" sort={sort} onToggle={sortToggle} />,
    entity_type: <SortableHeader key="h-entity_type" sortKey="entity_type" label="Module" sort={sort} onToggle={sortToggle} />,
    details: <TableHead key="h-details" className="text-xs hidden md:table-cell">Details</TableHead>,
  };

  const cells = (log: any): Record<string, JSX.Element> => ({
    created_at: (
      <TableCell key="c-created_at" className="text-xs text-muted-foreground whitespace-nowrap">
        {format(new Date(log.created_at), "MMM d, yyyy h:mm a")}
      </TableCell>
    ),
    user_email: <TableCell key="c-user_email" className="text-sm font-medium">{log.user_email}</TableCell>,
    action: (
      <TableCell key="c-action">
        <Badge variant="outline" className={`text-[10px] font-medium ${getActionColor(log.action)}`}>
          {log.action.replace(/_/g, " ")}
        </Badge>
      </TableCell>
    ),
    entity_type: <TableCell key="c-entity_type" className="text-sm capitalize">{log.entity_type.replace(/_/g, " ")}</TableCell>,
    details: (
      <TableCell key="c-details" className="text-xs text-muted-foreground hidden md:table-cell max-w-[300px] truncate">
        {Object.keys(log.details).length > 0
          ? Object.entries(log.details)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")
          : "—"}
      </TableCell>
    ),
  });

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Activity Log</h1>
        <p className="page-description">Track all actions performed across the system</p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <ColumnVisibilityMenu
          columns={orderedColumns}
          visible={state.visible}
          onToggle={toggle}
          onMove={move}
          onReset={reset}
        />
      </div>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>{visibleColumns.map((c) => heads[c.key])}</TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className="text-center py-8">
                  <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : sortedLogs && sortedLogs.length > 0 ? (
              sortedLogs.map((log) => {
                const rowCells = cells(log);
                return (
                  <TableRow key={log.id} className="hover:bg-muted/50">
                    {visibleColumns.map((c) => rowCells[c.key])}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className="text-center py-8 text-sm text-muted-foreground">
                  No activity logs found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

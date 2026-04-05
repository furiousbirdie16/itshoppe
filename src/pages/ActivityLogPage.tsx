import { useQuery } from "@tanstack/react-query";
import { getActivityLogs } from "@/lib/activity-log";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search } from "lucide-react";

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

export default function ActivityLogPage() {
  const [search, setSearch] = useState("");
  const { data: logs, isLoading } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: getActivityLogs,
  });

  const filtered = logs?.filter((log) => {
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

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Activity Log</h1>
        <p className="page-description">Track all actions performed across the system</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">When</TableHead>
              <TableHead className="text-xs">Who</TableHead>
              <TableHead className="text-xs">Action</TableHead>
              <TableHead className="text-xs">Module</TableHead>
              <TableHead className="text-xs hidden md:table-cell">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : filtered && filtered.length > 0 ? (
              filtered.map((log) => (
                <TableRow key={log.id} className="hover:bg-muted/50">
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.created_at), "MMM d, yyyy h:mm a")}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{log.user_email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] font-medium ${getActionColor(log.action)}`}>
                      {log.action.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm capitalize">{log.entity_type.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden md:table-cell max-w-[300px] truncate">
                    {Object.keys(log.details).length > 0
                      ? Object.entries(log.details)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
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

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { categoryKey } from "@/lib/expenses";
import { createExpenseCategory, getExpenseCategories, EXPENSE_CATEGORIES_KEY } from "@/lib/expenses-api";

interface Props {
  value: string;
  onChange: (name: string) => void;
  className?: string;
  placeholder?: string;
}

/**
 * The one category list, shared by banks, cash, payables and recurring bills.
 *
 * A name typed that is not on the list can be added on the spot and is
 * counted as an expense; an admin can change that on the Expenses page. An
 * older entry whose category is no longer on the list still shows its name.
 */
export function CategorySelect({ value, onChange, className, placeholder = "Pick a category" }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const { data: categories = [] } = useQuery({ queryKey: EXPENSE_CATEGORIES_KEY, queryFn: getExpenseCategories });

  const active = useMemo(() => categories.filter((c) => c.is_active), [categories]);
  const expenses = active.filter((c) => c.is_expense);
  const others = active.filter((c) => !c.is_expense);
  const typed = search.trim();
  const exists = !typed || categories.some((c) => categoryKey(c.name) === categoryKey(typed));

  const pick = (name: string) => { onChange(name); setOpen(false); setSearch(""); };

  const add = async () => {
    if (!typed) return;
    setAdding(true);
    try {
      const created = await createExpenseCategory(typed, true);
      await queryClient.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_KEY });
      pick(created.name);
      toast.success(`Added "${created.name}" as an expense category`);
    } catch (e) {
      toast.error((e as Error)?.message || "Could not add the category");
    }
    setAdding(false);
  };

  const item = (name: string) => (
    <CommandItem key={name} value={name} onSelect={() => pick(name)}>
      <Check className={cn("mr-2 h-4 w-4", categoryKey(value) === categoryKey(name) ? "opacity-100" : "opacity-0")} />
      {name}
    </CommandItem>
  );

  return (
    // Modal, so the list scrolls inside a dialog: otherwise the dialog's
    // scroll lock swallows the wheel and the list cannot be scrolled past the
    // first screenful.
    <Popover modal open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" type="button" className={cn("h-9 w-full justify-between font-normal", className)}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or add…" value={search} onValueChange={setSearch} className="h-9" />
          <CommandList className="max-h-72 overflow-y-auto overscroll-contain" onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
            <CommandEmpty>{typed ? "Not on the list" : "No categories"}</CommandEmpty>
            {!exists && (
              <CommandGroup>
                <CommandItem value={`__add__ ${typed}`} onSelect={add} disabled={adding}>
                  <Plus className="mr-2 h-4 w-4" /> Add “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            {value && (
              <CommandGroup>
                <CommandItem value="__none__" onSelect={() => pick("")} className="text-muted-foreground">
                  <span className="ml-6">No category</span>
                </CommandItem>
              </CommandGroup>
            )}
            {expenses.length > 0 && <CommandGroup heading="Expenses">{expenses.map((c) => item(c.name))}</CommandGroup>}
            {others.length > 0 && <CommandGroup heading="Not an expense">{others.map((c) => item(c.name))}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

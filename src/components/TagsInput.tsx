import { useMemo, useRef, useState, useEffect } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Tag as TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function normalizeTag(t: string) {
  return t.trim().replace(/\s+/g, " ");
}
export function tagKey(t: string) {
  return normalizeTag(t).toLowerCase();
}

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[]; // all known tag display names
  placeholder?: string;
  className?: string;
}

export function TagsInput({ value, onChange, suggestions, placeholder = "Add tag...", className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedKeys = useMemo(() => new Set(value.map(tagKey)), [value]);

  const available = useMemo(
    () => suggestions.filter((s) => !selectedKeys.has(tagKey(s))),
    [suggestions, selectedKeys],
  );

  const addTag = (raw: string) => {
    const clean = normalizeTag(raw);
    if (!clean) return;
    const k = tagKey(clean);
    if (selectedKeys.has(k)) return;
    // prefer existing casing if present in suggestions
    const existing = suggestions.find((s) => tagKey(s) === k);
    onChange([...value, existing || clean]);
    setQuery("");
  };

  const removeTag = (t: string) => {
    const k = tagKey(t);
    onChange(value.filter((v) => tagKey(v) !== k));
  };

  const canCreate =
    query.trim().length > 0 &&
    !selectedKeys.has(tagKey(query)) &&
    !suggestions.some((s) => tagKey(s) === tagKey(query));

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap gap-1 rounded-md border bg-background p-1.5 min-h-9">
        {value.map((t) => (
          <Badge key={tagKey(t)} variant="secondary" className="text-[11px] gap-1 pl-2 pr-1 h-6">
            <TagIcon className="h-3 w-3" />
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              className="ml-0.5 rounded hover:bg-muted-foreground/20 p-0.5"
              aria-label={`Remove ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded flex items-center gap-1"
              onClick={() => setOpen(true)}
            >
              <Plus className="h-3 w-3" />
              {value.length === 0 ? placeholder : "Add"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command shouldFilter>
              <CommandInput
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder="Search or create tag..."
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim()) {
                    e.preventDefault();
                    addTag(query);
                  }
                }}
              />
              <CommandList>
                <CommandEmpty>
                  {canCreate ? (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                      onClick={() => addTag(query)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Create "{normalizeTag(query)}"
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No tags</span>
                  )}
                </CommandEmpty>
                {available.length > 0 && (
                  <CommandGroup heading="Existing tags">
                    {available.map((s) => (
                      <CommandItem key={s} value={s} onSelect={() => addTag(s)}>
                        <TagIcon className="mr-2 h-3.5 w-3.5" />
                        {s}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {canCreate && available.length > 0 && (
                  <CommandGroup heading="Create">
                    <CommandItem value={`__create__${query}`} onSelect={() => addTag(query)}>
                      <Plus className="mr-2 h-3.5 w-3.5" /> Create "{normalizeTag(query)}"
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

interface FilterProps {
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  className?: string;
}

export function TagsFilter({ value, onChange, options, className }: FilterProps) {
  const [open, setOpen] = useState(false);
  const selectedKeys = useMemo(() => new Set(value.map(tagKey)), [value]);

  const toggle = (t: string) => {
    const k = tagKey(t);
    if (selectedKeys.has(k)) onChange(value.filter((v) => tagKey(v) !== k));
    else onChange([...value, t]);
  };

  const label =
    value.length === 0
      ? `All tags (${options.length})`
      : `${value.length} tag${value.length > 1 ? "s" : ""}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-1 text-xs font-normal h-8 w-[170px]",
            className,
          )}
        >
          <span className="truncate flex items-center gap-1.5">
            <TagIcon className="h-3.5 w-3.5 opacity-60" />
            {label}
          </span>
          {value.length > 0 && (
            <X
              className="h-3 w-3 opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search tags..." className="h-9" />
          <CommandList>
            <CommandEmpty>No tags</CommandEmpty>
            <CommandGroup>
              {options.map((t) => {
                const active = selectedKeys.has(tagKey(t));
                return (
                  <CommandItem key={t} value={t} onSelect={() => toggle(t)}>
                    <div
                      className={cn(
                        "mr-2 h-3.5 w-3.5 rounded border flex items-center justify-center",
                        active ? "bg-primary border-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {active && <span className="text-[10px] leading-none">✓</span>}
                    </div>
                    {t}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { CheckIcon, ChevronRightIcon, SkipForwardIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AgendaItem } from "@/lib/domain/service";
import type { OccurrenceStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

// Shared pieces of the planner (left) and todo (right) panels.

export type Action = "complete" | "skip" | "reopen";
const NEXT_STATUS: Record<Action, OccurrenceStatus> = { complete: "done", skip: "skipped", reopen: "pending" };

/** Applies `action` to the item optimistically; the caller refetches afterwards. */
export function applyAction(items: AgendaItem[], target: AgendaItem, action: Action): AgendaItem[] {
  const status = NEXT_STATUS[action];
  return items.map((i) =>
    i.occurrenceId === target.occurrenceId
      ? { ...i, status, overdue: status === "pending" && i.overdue, completedAt: status === "done" ? new Date().toISOString() : undefined }
      : i,
  );
}

export async function postAction(item: AgendaItem, action: Action): Promise<void> {
  const res = await fetch(`/api/occurrences/${encodeURIComponent(item.occurrenceId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? res.statusText);
  }
}

export function PanelShell({
  side,
  open,
  title,
  icon,
  count,
  onClose,
  toolbar,
  children,
}: {
  readonly side: "left" | "right";
  /** Mobile only: whether the panel is shown as an overlay. */
  readonly open: boolean;
  readonly title: string;
  readonly icon: ReactNode;
  readonly count?: number;
  readonly onClose: () => void;
  readonly toolbar?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "flex w-80 shrink-0 flex-col bg-background",
        side === "left" ? "border-r max-lg:left-0" : "border-l max-lg:right-0",
        "max-lg:fixed max-lg:inset-y-0 max-lg:z-30 max-lg:w-[min(20rem,100vw)] max-lg:shadow-xl",
        !open && "max-lg:hidden",
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <span className="flex items-center gap-2 font-medium text-sm">
          {icon}
          {title}
          {count !== undefined ? <span className="text-muted-foreground">{count}</span> : null}
        </span>
        <Button aria-label={`Close ${title.toLowerCase()}`} className="lg:hidden" onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon className="size-4" />
        </Button>
      </div>
      {toolbar}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6">{children}</div>
    </aside>
  );
}

export function ItemGroup({
  dot,
  label,
  count,
  defaultOpen = true,
  children,
}: {
  readonly dot: string;
  readonly label: string;
  readonly count: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        <span className={cn("size-2 rounded-full", dot)} />
        {label}
        <span className="ml-auto tabular-nums">{count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-0.5">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ItemRow({
  item,
  meta,
  onAct,
}: {
  readonly item: AgendaItem;
  /** Secondary line, e.g. date or goal labels. */
  readonly meta?: ReactNode;
  readonly onAct: (item: AgendaItem, action: Action) => void;
}) {
  const done = item.status === "done";
  const skipped = item.status === "skipped";
  return (
    <li className="group flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/60">
      <button
        aria-label={done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-foreground",
        )}
        onClick={() => onAct(item, done ? "reopen" : "complete")}
        type="button"
      >
        {done ? <CheckIcon className="size-3" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", (done || skipped) && "text-muted-foreground", done && "line-through")}>
          {item.title}
        </p>
        {meta || item.note || skipped ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            {skipped ? <Badge variant="outline">Skipped</Badge> : null}
            {meta}
            {item.note ? (
              <Badge className="max-w-full whitespace-normal text-left font-normal" variant="secondary">
                {item.note}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
      {item.status === "pending" || skipped ? (
        <Button
          aria-label={skipped ? `Undo skip of "${item.title}"` : `Skip "${item.title}"`}
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-60"
          onClick={() => onAct(item, skipped ? "reopen" : "skip")}
          size="icon-xs"
          title={skipped ? "Undo skip" : "Skip"}
          variant="ghost"
        >
          {skipped ? <XIcon /> : <SkipForwardIcon />}
        </Button>
      ) : null}
    </li>
  );
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Today", "Yesterday", "Tomorrow", else "Sat, Oct 3". Calendar dates, so format in UTC. */
export function formatDay(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

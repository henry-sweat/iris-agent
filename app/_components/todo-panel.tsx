"use client";

import { ListTodoIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgendaItem } from "@/lib/domain/service";
import type { OccurrenceStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { type Action, applyAction, formatDay, ItemGroup, ItemRow, PanelShell, postAction } from "./occurrence-list";

type TodoList = { today: string; items: AgendaItem[] };

const GROUPS: readonly { status: OccurrenceStatus; label: string; dot: string }[] = [
  { status: "pending", label: "Open", dot: "bg-blue-500" },
  { status: "done", label: "Done", dot: "bg-emerald-500" },
  { status: "skipped", label: "Skipped", dot: "bg-muted-foreground/50" },
];

/** Right panel: ad hoc to-dos, whatever their date. */
export function TodoPanel({
  refreshKey,
  open,
  onClose,
}: {
  /** Bump to refetch after the agent changes data. */
  readonly refreshKey: number;
  /** Mobile only: whether the panel is shown as an overlay. */
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const [list, setList] = useState<TodoList>();
  const [error, setError] = useState<string>();
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/todos", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: TodoList) => {
        setList(data);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => controller.abort();
  }, [refreshKey, localVersion]);

  const act = (item: AgendaItem, action: Action) => {
    setList((prev) => prev && { ...prev, items: applyAction(prev.items, item, action) });
    postAction(item, action)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Update failed"))
      .finally(() => setLocalVersion((v) => v + 1));
  };

  return (
    <PanelShell
      count={list?.items.filter((i) => i.status === "pending").length}
      icon={<ListTodoIcon className="size-4" />}
      onClose={onClose}
      open={open}
      side="right"
      title="Todos"
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {list === undefined && !error ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {list?.items.length === 0 ? <p className="text-muted-foreground text-sm">No todos yet.</p> : null}
      {list
        ? GROUPS.map((group) => {
            const items = list.items.filter((i) => i.status === group.status).sort(group.status === "pending" ? byDue : byCompleted);
            if (items.length === 0) return null;
            return (
              <ItemGroup count={items.length} defaultOpen={group.status === "pending"} dot={group.dot} key={group.status} label={group.label}>
                {items.map((item) => (
                  <ItemRow item={item} key={item.occurrenceId} meta={<Meta item={item} today={list.today} />} onAct={act} />
                ))}
              </ItemGroup>
            );
          })
        : null}
    </PanelShell>
  );
}

function Meta({ item, today }: { readonly item: AgendaItem; readonly today: string }) {
  const goals = item.goals.map((g) => g.title).join(", ");
  const pastDue = item.status === "pending" && item.dueAt !== undefined && item.dueAt < today;
  return (
    <>
      {item.status === "done" && item.completedAt ? (
        <span title={new Date(item.completedAt).toLocaleString()}>{formatRelative(Date.parse(item.completedAt))}</span>
      ) : item.dueAt ? (
        <span className={cn(pastDue && "font-medium text-destructive")}>due {formatDay(item.dueAt, today)}</span>
      ) : (
        <span>added {formatDay(item.scheduledFor, today)}</span>
      )}
      {goals ? <span>· {goals}</span> : null}
    </>
  );
}

/** Dated items first, soonest due; then undated, newest first. */
function byDue(a: AgendaItem, b: AgendaItem): number {
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt || b.dueAt) return a.dueAt ? -1 : 1;
  return b.scheduledFor.localeCompare(a.scheduledFor);
}

function byCompleted(a: AgendaItem, b: AgendaItem): number {
  return (b.completedAt ?? b.scheduledFor).localeCompare(a.completedAt ?? a.scheduledFor);
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatRelative(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

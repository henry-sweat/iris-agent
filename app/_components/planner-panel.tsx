"use client";

import { CalendarCheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Agenda, AgendaItem } from "@/lib/domain/service";
import type { Pillar } from "@/lib/domain/types";
import { type Action, addDays, applyAction, formatDay, ItemGroup, ItemRow, PanelShell, postAction } from "./occurrence-list";

const GROUPS: readonly { key: Pillar | "unaligned"; label: string; dot: string }[] = [
  { key: "health", label: "Health", dot: "bg-emerald-500" },
  { key: "wealth", label: "Wealth", dot: "bg-amber-500" },
  { key: "happiness", label: "Happiness", dot: "bg-sky-500" },
  { key: "unaligned", label: "Unaligned", dot: "bg-muted-foreground/50" },
];

/**
 * Left panel: one day's recurring tasks plus ad hoc to-dos due that day, and everything overdue.
 * Undated ad hoc to-dos only live in the right panel.
 */
export function PlannerPanel({
  refreshKey,
  open,
  onClose,
}: {
  /** Bump to refetch after the agent changes data. */
  readonly refreshKey: number;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  // undefined = the server's today.
  const [date, setDate] = useState<string>();
  const [agenda, setAgenda] = useState<Agenda>();
  const [error, setError] = useState<string>();
  const [localVersion, setLocalVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = date ? `?from=${date}&to=${date}` : "";
    fetch(`/api/agenda${query}`, { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: Agenda) => {
        setAgenda({ ...data, items: data.items.filter((i) => i.recurring || i.dueAt) });
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => controller.abort();
  }, [refreshKey, localVersion, date]);

  const act = (item: AgendaItem, action: Action) => {
    setAgenda((prev) => prev && { ...prev, items: applyAction(prev.items, item, action) });
    postAction(item, action)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Update failed"))
      .finally(() => setLocalVersion((v) => v + 1));
  };

  const day = agenda?.from;
  const overdue = agenda?.items.filter((i) => day && i.scheduledFor < day) ?? [];
  const dayItems = agenda?.items.filter((i) => i.scheduledFor === day && i.recurring) ?? [];
  const dueItems = agenda?.items.filter((i) => i.scheduledFor === day && !i.recurring) ?? [];
  const shift = (days: number) => day && setDate(addDays(day, days));

  return (
    <PanelShell
      count={agenda?.items.filter((i) => i.status === "pending").length}
      icon={<CalendarCheckIcon className="size-4" />}
      onClose={onClose}
      open={open}
      side="left"
      title="Planner"
      toolbar={
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-3">
          <Button aria-label="Previous day" disabled={!day} onClick={() => shift(-1)} size="icon-xs" variant="ghost">
            <ChevronLeftIcon />
          </Button>
          <button
            className="text-sm disabled:cursor-default"
            disabled={!agenda || day === agenda.today}
            onClick={() => setDate(undefined)}
            title="Back to today"
            type="button"
          >
            {agenda && day ? formatDay(day, agenda.today) : "…"}
          </button>
          <Button aria-label="Next day" disabled={!day} onClick={() => shift(1)} size="icon-xs" variant="ghost">
            <ChevronRightIcon />
          </Button>
        </div>
      }
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {agenda === undefined && !error ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {agenda && agenda.items.length === 0 ? <p className="text-muted-foreground text-sm">Nothing scheduled.</p> : null}

      {agenda && overdue.length > 0 ? (
        <ItemGroup count={overdue.length} dot="bg-destructive" label="Overdue">
          {overdue.map((item) => (
            <ItemRow item={item} key={item.occurrenceId} meta={formatDay(item.scheduledFor, agenda.today)} onAct={act} />
          ))}
        </ItemGroup>
      ) : null}

      {dueItems.length > 0 ? (
        <ItemGroup
          count={`${dueItems.filter((i) => i.status === "done").length}/${dueItems.length}`}
          dot="bg-blue-500"
          label="Ad hoc"
        >
          {dueItems.map((item) => (
            <ItemRow item={item} key={item.occurrenceId} meta={goalLabel(item)} onAct={act} />
          ))}
        </ItemGroup>
      ) : null}

      {GROUPS.map((group) => {
        const items = dayItems.filter((i) => (i.pillars[0] ?? "unaligned") === group.key);
        if (items.length === 0) return null;
        return (
          <ItemGroup
            count={`${items.filter((i) => i.status === "done").length}/${items.length}`}
            dot={group.dot}
            key={group.key}
            label={group.label}
          >
            {items.map((item) => (
              <ItemRow
                item={item}
                key={item.occurrenceId}
                meta={goalLabel(item)}
                onAct={act}
              />
            ))}
          </ItemGroup>
        );
      })}
    </PanelShell>
  );
}

function goalLabel(item: AgendaItem) {
  return item.goals.length > 0 ? <span>{item.goals.map((g) => g.title).join(", ")}</span> : undefined;
}

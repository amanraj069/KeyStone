import { ACTION_KINDS, ACTION_STATUSES, type ActionKind, type ActionStatus } from "@keystone/shared";
import { KIND_LABEL } from "@/components/actions/action-copy";
import { OptionPills } from "@/components/ui/option-pills";

export type StatusFilter = ActionStatus | "all";
export type KindFilter = ActionKind | "all";

const STATUS_OPTIONS = [{ value: "all", label: "All" }, ...ACTION_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))] as const;
const KIND_OPTIONS = [{ value: "all", label: "Every kind" }, ...ACTION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))] as const;

interface AuditFiltersProps {
  status: StatusFilter;
  kind: KindFilter;
  onStatus: (status: StatusFilter) => void;
  onKind: (kind: KindFilter) => void;
}

/** Status and kind filters, each a segmented control. */
export function AuditFilters({ status, kind, onStatus, onKind }: AuditFiltersProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <OptionPills<StatusFilter> label="Status" options={STATUS_OPTIONS} value={status} onChange={onStatus} className="shrink-0" />
      <OptionPills<KindFilter> label="Kind" options={KIND_OPTIONS} value={kind} onChange={onKind} fill className="min-w-0 flex-1" />
    </div>
  );
}

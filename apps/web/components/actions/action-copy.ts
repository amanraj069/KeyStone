import type { ActionKind } from "@keystone/shared";

export const KIND_LABEL: Record<ActionKind, string> = {
  reassign: "Reassign ticket",
  review_doc: "Review page",
  runbook: "Write runbook",
  handover: "Handover plan",
};

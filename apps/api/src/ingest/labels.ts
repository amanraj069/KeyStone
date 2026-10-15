/** Extra label for each artifact, by OrgForge doc_type (AGENTS.md section 5). */
export type ArtifactLabel = 'Ticket' | 'Page' | 'Thread' | 'PR' | 'Email' | 'Meeting' | 'Alert' | 'Record';

export const LABEL_BY_DOC_TYPE: Readonly<Record<string, ArtifactLabel>> = {
  jira: 'Ticket',
  zd_ticket: 'Ticket',
  confluence: 'Page',
  slack: 'Thread',
  pr: 'PR',
  email: 'Email',
  zoom_transcript: 'Meeting',
  datadog_alert: 'Alert',
  invoice: 'Record',
  sf_opp: 'Record',
  nps_survey: 'Record',
};

/** The label for a doc_type, or an error for a type the model does not know yet. */
export function labelFor(docType: string): ArtifactLabel {
  const label = LABEL_BY_DOC_TYPE[docType];
  if (!label) throw new Error(`No artifact label for doc_type "${docType}"; add it to LABEL_BY_DOC_TYPE`);
  return label;
}

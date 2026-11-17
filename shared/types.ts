export type NodeId = 'notebook' | 'drawer' | 'key' | 'door';
export type Action = { type: 'inspect'; target: NodeId } | { type: 'unlock'; code: string } | { type: 'collect' } | { type: 'escape' } | { type: 'hint' };
export interface PlayerState {
  started: boolean;
  inspected: NodeId[]; drawerOpen: boolean; hasKey: boolean; escaped: boolean;
  hintsUsed: number; startedAt: string; escapedAt: string | null; moves: number;
}
export interface PublicRoom {
  revision: string; title: string; subtitle: string; story: string; source: string;
  published: boolean; verified: boolean;
  notebookTitle: string; drawerTitle: string; keyTitle: string; doorTitle: string;
}
export interface PlayView { room: PublicRoom; state: PlayerState; message: string; notebook: string | null; hints: string[] }
export type Status = 'generated' | 'validating' | 'queued' | 'verifying' | 'repairing' | 'verified' | 'failed' | 'infrastructure-error';
export interface RevisionSummary { id: string; parentId: string | null; title: string; source: string; createdAt: string; status: Status; published: boolean; explanation: string }
export interface JobEvent { id: number; jobId: string; at: string; kind: string; message: string; data: Record<string, unknown> }
export interface JobSummary { id: string; revisionId: string; currentRevisionId: string; status: Status; repairs: number; createdAt: string; updatedAt: string; events: JobEvent[] }
export interface WorkshopView { revisions: RevisionSummary[]; jobs: JobSummary[]; capabilities: { ai: boolean; operator: boolean; kane: string; model: string | null }; publishedRevision: string | null }

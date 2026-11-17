export const reviewCategories = ['possible_sexual', 'possible_extremist', 'offensive_text'] as const;
export type ReviewCategory = typeof reviewCategories[number];
export type ReviewDecision = 'false_positive' | 'allowed' | 'private_only' | 'omit';
export type ReviewOrigin = 'manual' | 'mcp' | 'machine';
export type ReviewScope = { kind: 'full' | 'partial' | 'unspecified'; startSeconds?: number; endSeconds?: number; note?: string };
export type ReviewFlag = { id: string; category: ReviewCategory; origin: ReviewOrigin; reason: string; createdAt: string; scope: ReviewScope; evidenceContentHash: string };
export type ReviewItem = {
  id: string; sourceId: string; mediaId?: string; versionId?: string; elementId?: string;
  kind: 'text' | 'photo' | 'audio' | 'video'; contentHash: string; contributor: string;
  previewUrl?: string; text?: string; categories: ReviewCategory[]; flags: ReviewFlag[];
  decision: ReviewDecision | null; decidedBy?: string; decidedAt?: string; scope: ReviewScope;
  contentChanged: boolean; status: 'pending' | 'resolved' | 'unreviewed' | 'changed';
  history: { decision: ReviewDecision; scope: ReviewScope; note?: string; actorId: string; createdAt: string; revision: number }[];
  affectedPages: { versionId: string; pageNumbers: number[]; approved: boolean }[];
};
export type ReviewState = {
  revision: number; items: ReviewItem[]; pendingCount: number; pendingIds: string[];
  totalCount: number; targetCount: number;
  capabilities: { delete: false; audio: false; video: false; automatedDetection: false; publicSharing: false };
};
export type ReviewOmissionReason = 'pending' | 'omit' | 'private_only';
export type ReviewOmittedItem = { sourceId: string; guestId: string; contributor: string; reviewId: string; kind: 'text' | 'photo' | 'audio' | 'video'; reason: ReviewOmissionReason; reasonLabel: string };
export type ReviewSummary = {
  revision: number; pendingCount: number; pendingIds: string[]; restrictedIds: string[];
  omittedItems: ReviewOmittedItem[]; partialOmissions: ReviewOmittedItem[];
  omittedContributors: { guestId: string; contributor: string; sourceIds: string[]; reviewIds: string[]; reasons: ReviewOmissionReason[]; reasonLabels: string[] }[];
};
export type ReviewDraftPolicy = {
  revision: number; blocked: boolean; affectedPages: number[]; blockedElementIds: string[];
  pendingIds: string[]; restrictedIds: string[]; requiresReview: boolean;
};
export type CreateReviewInput = { key: string; sourceId: string; mediaId?: string; versionId?: string; elementId?: string; expectedContentHash?: string; categories: ReviewCategory[]; reason: string; scope: ReviewScope };
export type DecideReviewInput = { key: string; decision: ReviewDecision; note?: string; scope: ReviewScope; expectedRevision?: number };
export type ReviewListOptions = { category?: ReviewCategory; status?: 'all' | ReviewItem['status']; sourceId?: string; versionId?: string };

export type MediaKind = 'photo' | 'video' | 'audio';

// Counts apply to committed submissions in one book for one guest cookie identity.
export const guestMediaLimits = {
  photo: { maxCount: 10, maxBytes: 6 * 1024 * 1024 },
  video: { maxCount: 2, maxBytes: 24 * 1024 * 1024 },
  audio: { maxCount: 2, maxBytes: 8 * 1024 * 1024 },
} as const;
export const maxMediaDurationSeconds = 20;
export const supportedMediaMimeTypes = {
  photo: ['image/jpeg', 'image/png'],
  video: ['video/webm', 'video/mp4', 'video/quicktime'],
  audio: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'],
} as const;

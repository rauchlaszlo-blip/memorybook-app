-- Existing photo rows and original bytes are unchanged. AV has no image derivatives.
ALTER TABLE event_submissions DROP CONSTRAINT event_submissions_message_check;
ALTER TABLE event_submissions ADD CONSTRAINT event_submissions_message_check CHECK(char_length(message) BETWEEN 0 AND 4000);
ALTER TABLE event_media ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE event_media ADD COLUMN duration_seconds DOUBLE PRECISION;
ALTER TABLE event_media ADD COLUMN guest_device_id TEXT;
ALTER TABLE event_media DROP CONSTRAINT event_media_mime_type_check;
ALTER TABLE event_media ADD CONSTRAINT event_media_kind_check CHECK (kind IN ('photo','audio','video'));
ALTER TABLE event_media ADD CONSTRAINT event_media_type_check CHECK (
 (kind='photo' AND mime_type IN ('image/jpeg','image/png') AND duration_seconds IS NULL) OR
 (kind='audio' AND mime_type IN ('audio/webm','audio/mp4','audio/ogg','audio/wav') AND width=0 AND height=0 AND duration_seconds IS NOT NULL AND duration_seconds>0 AND duration_seconds<=20 AND octet_length(preview_bytes)=0 AND octet_length(display_bytes)=0) OR
 (kind='video' AND mime_type IN ('video/webm','video/mp4','video/quicktime') AND width>0 AND height>0 AND duration_seconds IS NOT NULL AND duration_seconds>0 AND duration_seconds<=20 AND octet_length(preview_bytes)=0 AND octet_length(display_bytes)=0)
);
ALTER TABLE event_media ADD CONSTRAINT event_media_guest_identity_check CHECK (guest_device_id IS NULL OR guest_device_id ~ '^[a-f0-9]{64}$');
CREATE INDEX event_media_guest_kind_idx ON event_media(book_id,guest_device_id,kind) WHERE state='attached';
ALTER TABLE event_book_snapshot_media ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo' CHECK(kind IN ('photo','audio','video'));
ALTER TABLE event_book_snapshot_media ADD COLUMN duration_seconds DOUBLE PRECISION;

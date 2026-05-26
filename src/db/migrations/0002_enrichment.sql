-- Phase 2: understanding (transcription + vision) stored on findings.
alter table findings add column transcript text;
alter table findings add column transcript_language text;
alter table findings add column transcript_segments text; -- JSON array of {start,end,text}
alter table findings add column visual_summary text;
alter table findings add column onscreen_text text;
alter table findings add column enrich_status text not null default 'pending';
alter table findings add column enriched_at text;

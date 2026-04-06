-- Migration: add_activity_category
-- Adds 'activity' to the event_category enum.

ALTER TYPE event_category ADD VALUE IF NOT EXISTS 'activity';

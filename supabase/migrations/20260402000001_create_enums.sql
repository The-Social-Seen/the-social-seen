-- Migration: 001_create_enums
-- Creates all custom enum types for The Social Seen schema.
-- Idempotent: uses DO $$ blocks to check existence before creating.

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('member', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE event_category AS ENUM (
    'drinks', 'dining', 'cultural', 'wellness',
    'sport', 'workshops', 'music', 'networking'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM (
    'confirmed', 'cancelled', 'waitlisted', 'no_show'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Amendment 1.3: notification enums
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'reminder', 'announcement', 'waitlist', 'event_update'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_recipient AS ENUM (
    'all', 'event_attendees', 'waitlisted', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

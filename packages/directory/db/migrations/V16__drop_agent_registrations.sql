-- V16__drop_agent_registrations.sql
-- agent_registrations was created in V2 based on an early design doc but was never
-- wired into production code. agent_profiles (V9) is the authoritative agent identity
-- table. This migration drops the dead stub to eliminate confusion.
DROP TABLE IF EXISTS agent_registrations;

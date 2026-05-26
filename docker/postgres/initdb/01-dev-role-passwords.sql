-- Dev-only role passwords for local Docker Compose environment.
-- Roles are created by Flyway migrations (V2, V7, V26) with no password.
-- This script sets dev passwords so application pools can connect locally.
-- Production passwords are managed by the rotation Lambda and never stored in source control.
ALTER ROLE cello_service     PASSWORD 'cello_service_dev';
ALTER ROLE cello_analytics   PASSWORD 'cello_analytics_dev';
ALTER ROLE cello_ops_agent   PASSWORD 'cello_ops_agent_dev';

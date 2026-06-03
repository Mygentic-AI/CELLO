-- V28__grant_cello_service_update_agent_profiles.sql
-- Purpose: Grant UPDATE permission on agent_profiles to cello_service role.
-- Context: linkAgentToAccount() in the directory registration flow calls
--          UPDATE agent_profiles SET account_id = ... WHERE k_local_pubkey = ...
--          This UPDATE fails in production (RDS with cello_service role) because
--          cello_service was granted only SELECT and INSERT on agent_profiles,
--          not UPDATE. The bug was latent because CI tests run as superuser.
--          This migration closes the gap discovered in OPS-AGENT-001.
-- Story: CELLO-M6B-004

GRANT UPDATE ON agent_profiles TO cello_service;

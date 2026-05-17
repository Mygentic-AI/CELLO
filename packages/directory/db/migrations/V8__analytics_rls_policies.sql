-- V8__analytics_rls_policies.sql — RLS SELECT policies for cello_analytics role
--
-- The cello_analytics role has GRANT SELECT on protocol tables (V2, V7) but no
-- RLS SELECT policy — RLS blocks all rows for roles without an explicit policy.
-- This migration adds SELECT policies so the analytics job can read the protocol
-- tables it was designed to aggregate.
--
-- Tables: the five tables the analytics job reads from (PERSIST-008 AC-001–AC-004).
-- All policies are FOR SELECT only — cello_analytics cannot INSERT, UPDATE, or DELETE.

CREATE POLICY analytics_select ON conversation_seals
  FOR SELECT TO cello_analytics USING (true);

CREATE POLICY analytics_select ON conversation_participation
  FOR SELECT TO cello_analytics USING (true);

CREATE POLICY analytics_select ON conversation_attestations
  FOR SELECT TO cello_analytics USING (true);

CREATE POLICY analytics_select ON agent_registrations
  FOR SELECT TO cello_analytics USING (true);

CREATE POLICY analytics_select ON notification_events
  FOR SELECT TO cello_analytics USING (true);

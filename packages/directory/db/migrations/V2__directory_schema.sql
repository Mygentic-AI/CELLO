-- CELLO-PERSIST-003 — Append-only directory schema with RLS enforcement
--
-- Design rules (from persistence-layer-design discussion log):
--   1. RLS is ENABLED in the SAME migration as table creation — never retroactively.
--   2. cello_service gets explicit INSERT + SELECT policies and matching GRANTs.
--   3. UPDATE and DELETE are explicitly REVOKEd from cello_service, producing a hard
--      permission-denied error (not a silent UPDATE 0 / DELETE 0).
--   4. cello_service has NO DDL privileges — tables are owned by the postgres superuser.
--   5. Superuser can still UPDATE/DELETE (addressed by hash chain PERSIST-004 and pgaudit PERSIST-006).
--
-- Active M4 tables (conversation_seals, conversation_attestations, conversation_participation,
-- agent_registrations [dropped in V16 — never wired into production; see agent_profiles V9],
-- connection_requests, notification_events) receive full column definitions
-- from the persistence-layer-design discussion log.
-- All other tables receive stub schema (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ).
--
-- RLS pattern applied identically to every append-only table:
--   ALTER TABLE {name} ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY insert_only ON {name} FOR INSERT TO cello_service WITH CHECK (true);
--   CREATE POLICY select_all  ON {name} FOR SELECT  TO cello_service USING (true);
--   GRANT INSERT, SELECT ON {name} TO cello_service;
--   REVOKE UPDATE, DELETE ON {name} FROM cello_service;

-- ─── Role setup ──────────────────────────────────────────────────────────────
-- cello_service: restricted application role — INSERT + SELECT only, no DDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cello_service') THEN
    CREATE ROLE cello_service LOGIN; -- password set by docker/postgres/initdb/ (local) or rotation Lambda (production)
  END IF;
END;
$$;

-- Grant connection to cello_dev database (required for pool connections)
-- (GRANT CONNECT is idempotent across re-runs)
GRANT CONNECT ON DATABASE cello_dev TO cello_service; -- matches Flyway's target db; update if db renamed
GRANT USAGE ON SCHEMA public TO cello_service;

-- ─── Active M4 tables — full column definitions ──────────────────────────────

-- NOTE: this table is dropped in V16__drop_agent_registrations.sql — agent_profiles (V9) is the authoritative agent identity table
-- agent_registrations — from persistence-layer-design §"Agent registration schema"
CREATE TABLE IF NOT EXISTS agent_registrations (
  id                          BIGSERIAL   PRIMARY KEY,
  agent_id                    UUID        NOT NULL UNIQUE,
  identity_key_hash           TEXT        NOT NULL,
  phone_hash                  TEXT        NOT NULL UNIQUE,
  initial_signing_key_hash    TEXT        NOT NULL,
  initial_fallback_pubkey_hash TEXT       NOT NULL,
  trust_tier                  TEXT        NOT NULL CHECK (trust_tier IN ('PROVISIONAL', 'VERIFIED_MOBILE', 'VERIFIED_DEVICE')),
  provisional_period_start    TIMESTAMPTZ NOT NULL,
  registered_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  chain_hash                  TEXT                                     -- PERSIST-004: SHA-256(record || prev_hash)
);
ALTER TABLE agent_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON agent_registrations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON agent_registrations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON agent_registrations TO cello_service;
REVOKE UPDATE, DELETE ON agent_registrations FROM cello_service;

-- connection_requests — from persistence-layer-design §"Connection records"
CREATE TABLE IF NOT EXISTS connection_requests (
  id                    BIGSERIAL   PRIMARY KEY,
  request_id            UUID        NOT NULL UNIQUE,
  requester_pseudonym   TEXT        NOT NULL,
  target_pseudonym      TEXT        NOT NULL,
  outcome               TEXT        NOT NULL CHECK (outcome IN ('ACCEPTED', 'REJECTED', 'EXPIRED', 'PENDING_ESCALATION')),
  rejection_reason      TEXT        CHECK (rejection_reason IN ('POLICY_BLOCK', 'INSUFFICIENT_ENDORSEMENTS', 'INTRODUCTION_REQUIRED', 'RATE_LIMITED', 'BLOCKED', 'ALIAS_RETIRED')),
  via_alias_id          UUID,
  escalation_expires_at TIMESTAMPTZ,
  conversation_id       UUID,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  chain_hash            TEXT                                           -- PERSIST-004
);
ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON connection_requests FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON connection_requests FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON connection_requests TO cello_service;
REVOKE UPDATE, DELETE ON connection_requests FROM cello_service;

-- conversation_seals — from persistence-layer-design §"Conversation records" Table 1
CREATE TABLE IF NOT EXISTS conversation_seals (
  id                BIGSERIAL   PRIMARY KEY,
  conversation_id   UUID        NOT NULL UNIQUE,
  merkle_root       TEXT        NOT NULL,
  close_type        TEXT        NOT NULL CHECK (close_type IN ('MUTUAL_SEAL', 'SEAL_UNILATERAL', 'EXPIRE', 'ABORT', 'REOPEN')),
  close_reason_code TEXT,
  participant_count INTEGER     NOT NULL CHECK (participant_count >= 2),
  seal_date         DATE        NOT NULL,
  chain_hash        TEXT                                               -- PERSIST-004
);
ALTER TABLE conversation_seals ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_seals FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON conversation_seals FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON conversation_seals TO cello_service;
REVOKE UPDATE, DELETE ON conversation_seals FROM cello_service;

-- conversation_attestations — from persistence-layer-design §"Table 1a — Conversation Attestations"
CREATE TABLE IF NOT EXISTS conversation_attestations (
  id                     BIGSERIAL   PRIMARY KEY,
  conversation_id        UUID        NOT NULL REFERENCES conversation_seals(conversation_id),
  participant_pseudonym   TEXT        NOT NULL,
  attestation            TEXT        NOT NULL CHECK (attestation IN ('CLEAN', 'FLAGGED', 'PENDING', 'DELIVERED', 'ABSENT')),
  seal_signature         TEXT        NOT NULL,
  attested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  chain_hash             TEXT                                          -- PERSIST-004
);
ALTER TABLE conversation_attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_attestations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON conversation_attestations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON conversation_attestations TO cello_service;
REVOKE UPDATE, DELETE ON conversation_attestations FROM cello_service;

-- conversation_participation — from persistence-layer-design §"Table 2 — Conversation Participation"
CREATE TABLE IF NOT EXISTS conversation_participation (
  id                BIGSERIAL   PRIMARY KEY,
  conversation_id   UUID        NOT NULL REFERENCES conversation_seals(conversation_id),
  party_pseudonym   TEXT        NOT NULL,
  chain_hash        TEXT                                               -- PERSIST-004
);
CREATE INDEX IF NOT EXISTS idx_conversation_participation_pseudonym ON conversation_participation (party_pseudonym);
ALTER TABLE conversation_participation ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_participation FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON conversation_participation FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON conversation_participation TO cello_service;
REVOKE UPDATE, DELETE ON conversation_participation FROM cello_service;

-- notification_events — from persistence-layer-design §"Notification events"
CREATE TABLE IF NOT EXISTS notification_events (
  id                    BIGSERIAL   PRIMARY KEY,
  notification_id       UUID        NOT NULL UNIQUE,
  sender_pseudonym      TEXT,
  recipient_pseudonym   TEXT        NOT NULL,
  notification_type     TEXT        NOT NULL CHECK (notification_type IN ('INTRODUCTION', 'TOMBSTONE_ALERT', 'RECOVERY_CONTACT_DESIGNATED', 'RECOVERY_ATTESTATION_REQUESTED', 'CONNECTION_ESCALATION_RESOLVED', 'SYSTEM')),
  payload_hash          TEXT        NOT NULL,
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  chain_hash            TEXT                                           -- PERSIST-004
);
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON notification_events FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON notification_events FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON notification_events TO cello_service;
REVOKE UPDATE, DELETE ON notification_events FROM cello_service;

-- ─── Stub tables — id + created_at; full columns added in future stories ─────

-- social_verifications
CREATE TABLE IF NOT EXISTS social_verifications (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE social_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON social_verifications FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON social_verifications FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON social_verifications TO cello_service;
REVOKE UPDATE, DELETE ON social_verifications FROM cello_service;

-- social_verification_freshness_checks
CREATE TABLE IF NOT EXISTS social_verification_freshness_checks (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE social_verification_freshness_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON social_verification_freshness_checks FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON social_verification_freshness_checks FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON social_verification_freshness_checks TO cello_service;
REVOKE UPDATE, DELETE ON social_verification_freshness_checks FROM cello_service;

-- social_binding_releases
CREATE TABLE IF NOT EXISTS social_binding_releases (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE social_binding_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON social_binding_releases FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON social_binding_releases FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON social_binding_releases TO cello_service;
REVOKE UPDATE, DELETE ON social_binding_releases FROM cello_service;

-- device_bindings
CREATE TABLE IF NOT EXISTS device_bindings (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE device_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON device_bindings FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON device_bindings FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON device_bindings TO cello_service;
REVOKE UPDATE, DELETE ON device_bindings FROM cello_service;

-- endorsements
CREATE TABLE IF NOT EXISTS endorsements (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE endorsements ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON endorsements FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON endorsements FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON endorsements TO cello_service;
REVOKE UPDATE, DELETE ON endorsements FROM cello_service;

-- attestations
CREATE TABLE IF NOT EXISTS attestations (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON attestations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON attestations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON attestations TO cello_service;
REVOKE UPDATE, DELETE ON attestations FROM cello_service;

-- bio_history
CREATE TABLE IF NOT EXISTS bio_history (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bio_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON bio_history FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON bio_history FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON bio_history TO cello_service;
REVOKE UPDATE, DELETE ON bio_history FROM cello_service;

-- pseudonym_bindings
CREATE TABLE IF NOT EXISTS pseudonym_bindings (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pseudonym_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON pseudonym_bindings FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON pseudonym_bindings FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON pseudonym_bindings TO cello_service;
REVOKE UPDATE, DELETE ON pseudonym_bindings FROM cello_service;

-- conversation_proof_leaves
CREATE TABLE IF NOT EXISTS conversation_proof_leaves (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE conversation_proof_leaves ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_proof_leaves FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON conversation_proof_leaves FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON conversation_proof_leaves TO cello_service;
REVOKE UPDATE, DELETE ON conversation_proof_leaves FROM cello_service;

-- conversation_proof_mmr_nodes
CREATE TABLE IF NOT EXISTS conversation_proof_mmr_nodes (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE conversation_proof_mmr_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_proof_mmr_nodes FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON conversation_proof_mmr_nodes FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON conversation_proof_mmr_nodes TO cello_service;
REVOKE UPDATE, DELETE ON conversation_proof_mmr_nodes FROM cello_service;

-- directory_checkpoints
CREATE TABLE IF NOT EXISTS directory_checkpoints (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE directory_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON directory_checkpoints FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON directory_checkpoints FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON directory_checkpoints TO cello_service;
REVOKE UPDATE, DELETE ON directory_checkpoints FROM cello_service;

-- checkpoint_node_signatures
CREATE TABLE IF NOT EXISTS checkpoint_node_signatures (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE checkpoint_node_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON checkpoint_node_signatures FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON checkpoint_node_signatures FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON checkpoint_node_signatures TO cello_service;
REVOKE UPDATE, DELETE ON checkpoint_node_signatures FROM cello_service;

-- arbitration_verdicts
CREATE TABLE IF NOT EXISTS arbitration_verdicts (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE arbitration_verdicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON arbitration_verdicts FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON arbitration_verdicts FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON arbitration_verdicts TO cello_service;
REVOKE UPDATE, DELETE ON arbitration_verdicts FROM cello_service;

-- revocations
CREATE TABLE IF NOT EXISTS revocations (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE revocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON revocations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON revocations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON revocations TO cello_service;
REVOKE UPDATE, DELETE ON revocations FROM cello_service;

-- tombstones
CREATE TABLE IF NOT EXISTS tombstones (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON tombstones FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON tombstones FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON tombstones TO cello_service;
REVOKE UPDATE, DELETE ON tombstones FROM cello_service;

-- social_proof_freezes
CREATE TABLE IF NOT EXISTS social_proof_freezes (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE social_proof_freezes ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON social_proof_freezes FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON social_proof_freezes FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON social_proof_freezes TO cello_service;
REVOKE UPDATE, DELETE ON social_proof_freezes FROM cello_service;

-- anomaly_events
CREATE TABLE IF NOT EXISTS anomaly_events (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE anomaly_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON anomaly_events FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON anomaly_events FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON anomaly_events TO cello_service;
REVOKE UPDATE, DELETE ON anomaly_events FROM cello_service;

-- recovery_contact_designations
CREATE TABLE IF NOT EXISTS recovery_contact_designations (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE recovery_contact_designations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON recovery_contact_designations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON recovery_contact_designations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON recovery_contact_designations TO cello_service;
REVOKE UPDATE, DELETE ON recovery_contact_designations FROM cello_service;

-- recovery_contact_members
CREATE TABLE IF NOT EXISTS recovery_contact_members (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE recovery_contact_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON recovery_contact_members FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON recovery_contact_members FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON recovery_contact_members TO cello_service;
REVOKE UPDATE, DELETE ON recovery_contact_members FROM cello_service;

-- recovery_events
CREATE TABLE IF NOT EXISTS recovery_events (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE recovery_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON recovery_events FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON recovery_events FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON recovery_events TO cello_service;
REVOKE UPDATE, DELETE ON recovery_events FROM cello_service;

-- recovery_vouches
CREATE TABLE IF NOT EXISTS recovery_vouches (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE recovery_vouches ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON recovery_vouches FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON recovery_vouches FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON recovery_vouches TO cello_service;
REVOKE UPDATE, DELETE ON recovery_vouches FROM cello_service;

-- voucher_accountability_events
CREATE TABLE IF NOT EXISTS voucher_accountability_events (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE voucher_accountability_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON voucher_accountability_events FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON voucher_accountability_events FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON voucher_accountability_events TO cello_service;
REVOKE UPDATE, DELETE ON voucher_accountability_events FROM cello_service;

-- voucher_lockouts
CREATE TABLE IF NOT EXISTS voucher_lockouts (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE voucher_lockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON voucher_lockouts FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON voucher_lockouts FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON voucher_lockouts TO cello_service;
REVOKE UPDATE, DELETE ON voucher_lockouts FROM cello_service;

-- trust_seeders
CREATE TABLE IF NOT EXISTS trust_seeders (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE trust_seeders ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON trust_seeders FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON trust_seeders FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON trust_seeders TO cello_service;
REVOKE UPDATE, DELETE ON trust_seeders FROM cello_service;

-- seeder_vouches
CREATE TABLE IF NOT EXISTS seeder_vouches (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seeder_vouches ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON seeder_vouches FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON seeder_vouches FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON seeder_vouches TO cello_service;
REVOKE UPDATE, DELETE ON seeder_vouches FROM cello_service;

-- seeder_accountability_events
CREATE TABLE IF NOT EXISTS seeder_accountability_events (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seeder_accountability_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON seeder_accountability_events FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON seeder_accountability_events FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON seeder_accountability_events TO cello_service;
REVOKE UPDATE, DELETE ON seeder_accountability_events FROM cello_service;

-- seeder_lockouts
CREATE TABLE IF NOT EXISTS seeder_lockouts (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seeder_lockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON seeder_lockouts FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON seeder_lockouts FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON seeder_lockouts TO cello_service;
REVOKE UPDATE, DELETE ON seeder_lockouts FROM cello_service;

-- key_rotation_log
CREATE TABLE IF NOT EXISTS key_rotation_log (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE key_rotation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON key_rotation_log FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON key_rotation_log FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON key_rotation_log TO cello_service;
REVOKE UPDATE, DELETE ON key_rotation_log FROM cello_service;

-- identity_migration_log
CREATE TABLE IF NOT EXISTS identity_migration_log (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE identity_migration_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON identity_migration_log FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON identity_migration_log FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON identity_migration_log TO cello_service;
REVOKE UPDATE, DELETE ON identity_migration_log FROM cello_service;

-- agent_authorizations
CREATE TABLE IF NOT EXISTS agent_authorizations (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agent_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON agent_authorizations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON agent_authorizations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON agent_authorizations TO cello_service;
REVOKE UPDATE, DELETE ON agent_authorizations FROM cello_service;

-- authorization_revocations
CREATE TABLE IF NOT EXISTS authorization_revocations (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE authorization_revocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON authorization_revocations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON authorization_revocations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON authorization_revocations TO cello_service;
REVOKE UPDATE, DELETE ON authorization_revocations FROM cello_service;

-- authorization_violation_events
CREATE TABLE IF NOT EXISTS authorization_violation_events (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE authorization_violation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON authorization_violation_events FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON authorization_violation_events FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON authorization_violation_events TO cello_service;
REVOKE UPDATE, DELETE ON authorization_violation_events FROM cello_service;

-- contact_aliases
CREATE TABLE IF NOT EXISTS contact_aliases (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE contact_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON contact_aliases FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON contact_aliases FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON contact_aliases TO cello_service;
REVOKE UPDATE, DELETE ON contact_aliases FROM cello_service;

-- contact_alias_retirements
CREATE TABLE IF NOT EXISTS contact_alias_retirements (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE contact_alias_retirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON contact_alias_retirements FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON contact_alias_retirements FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON contact_alias_retirements TO cello_service;
REVOKE UPDATE, DELETE ON contact_alias_retirements FROM cello_service;

-- directory_listings
CREATE TABLE IF NOT EXISTS directory_listings (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE directory_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON directory_listings FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON directory_listings FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON directory_listings TO cello_service;
REVOKE UPDATE, DELETE ON directory_listings FROM cello_service;

-- group_rooms
CREATE TABLE IF NOT EXISTS group_rooms (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE group_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON group_rooms FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON group_rooms FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON group_rooms TO cello_service;
REVOKE UPDATE, DELETE ON group_rooms FROM cello_service;

-- room_memberships
CREATE TABLE IF NOT EXISTS room_memberships (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE room_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON room_memberships FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON room_memberships FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON room_memberships TO cello_service;
REVOKE UPDATE, DELETE ON room_memberships FROM cello_service;

-- ─── Grant sequences for BIGSERIAL columns ───────────────────────────────────
-- cello_service needs USAGE on sequences to perform INSERT with auto-increment.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO cello_service; -- ambient: covers all sequences including future ones; cello_service has no DDL so it cannot create sequences

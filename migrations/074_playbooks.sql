-- Migration: Playbooks with step tracking.
--
-- Playbooks are reusable checklists (onboarding, incident response, deploy).
-- Each step can be assigned to a user and marked complete.

CREATE TABLE IF NOT EXISTS playbooks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    created_by  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_server
    ON playbooks (server_id);

CREATE TABLE IF NOT EXISTS playbook_steps (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    playbook_id   UUID        NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
    position      INT         NOT NULL DEFAULT 0,
    title         TEXT        NOT NULL,
    assignee_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
    completed     BOOLEAN     NOT NULL DEFAULT FALSE,
    completed_at  TIMESTAMPTZ,
    completed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbook_steps_playbook
    ON playbook_steps (playbook_id, position);

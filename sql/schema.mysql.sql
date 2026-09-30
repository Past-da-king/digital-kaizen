-- Digital Kaizen — MySQL schema.
--
-- `production` is deliberately identical to the table the client's
-- existing Node-RED flows already write to, so their History Data
-- Browser flow works against this database with no edits.

CREATE DATABASE IF NOT EXISTS digital_kaizen
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE digital_kaizen;

CREATE TABLE IF NOT EXISTS production (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  timestamp  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  machine_id VARCHAR(16) NOT NULL,
  cycletime  FLOAT,
  downtime   FLOAT,
  INDEX idx_prod_ts (timestamp),
  INDEX idx_prod_machine (machine_id, timestamp)
);

-- Added by this project; the client's flows do not use it and are
-- unaffected by it. Gives downtime as real intervals instead of
-- inferring it from cycle-time buckets.
CREATE TABLE IF NOT EXISTS machine_events (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  timestamp  DATETIME    NOT NULL,
  machine_id VARCHAR(16) NOT NULL,
  status     VARCHAR(24) NOT NULL,
  ended_at   DATETIME NULL,
  seconds    FLOAT NULL,
  INDEX idx_ev_machine (machine_id, timestamp)
);

-- The downtime engine's own tables. These were missing from the first
-- version of this file, which meant the advertised MySQL path silently
-- dropped every downtime event, micro-stop and alert.
CREATE TABLE IF NOT EXISTS downtime_events (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  machine_id    VARCHAR(16) NOT NULL,
  started_at    DATETIME    NOT NULL,
  ended_at      DATETIME NULL,
  seconds       FLOAT NULL,
  level         VARCHAR(16) NOT NULL DEFAULT 'downtime',
  state         VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  reason_code   VARCHAR(32) NULL,
  reason_label  VARCHAR(64) NULL,
  note          TEXT NULL,
  attributed_at DATETIME NULL,
  planned       TINYINT(1) NULL,
  lost_shots    INT NULL,
  lost_value    FLOAT NULL,
  INDEX idx_dt_machine (machine_id, started_at),
  INDEX idx_dt_state (state)
);

CREATE TABLE IF NOT EXISTS micro_stops (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  machine_id VARCHAR(16) NOT NULL,
  at         DATETIME    NOT NULL,
  seconds    FLOAT       NOT NULL,
  INDEX idx_ms_machine (machine_id, at)
);

CREATE TABLE IF NOT EXISTS alerts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  event_id   INT         NOT NULL,
  machine_id VARCHAR(16) NOT NULL,
  at         DATETIME    NOT NULL,
  level      VARCHAR(24) NOT NULL,
  channel    VARCHAR(24) NOT NULL,
  recipient  VARCHAR(64) NOT NULL,
  message    TEXT        NOT NULL,
  delivered  TINYINT(1)  NOT NULL DEFAULT 0,
  detail     TEXT NULL,
  INDEX idx_al_event (event_id)
);

CREATE TABLE IF NOT EXISTS heartbeat (
  machine_id VARCHAR(16) PRIMARY KEY,
  last_seen  DATETIME NOT NULL,
  source     VARCHAR(16)
);

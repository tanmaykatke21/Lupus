-- Tiger Data (TimescaleDB) schema for Lupus. Safe to re-run.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- One row per GPS fix. `time` is the fix time from ETA Spot (receiveTime),
-- so re-polling an unchanged position is a no-op thanks to the unique index.
CREATE TABLE IF NOT EXISTS vehicle_snapshots (
  time          timestamptz      NOT NULL,
  vehicle_id    text             NOT NULL,
  route_id      integer          NOT NULL,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  heading       smallint,
  next_stop_id  integer,
  in_service    boolean          NOT NULL,
  load          real,
  polled_at     timestamptz      NOT NULL DEFAULT now()
);
SELECT create_hypertable('vehicle_snapshots', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_snapshots_vehicle_time ON vehicle_snapshots (vehicle_id, time);
CREATE INDEX IF NOT EXISTS vehicle_snapshots_route_time ON vehicle_snapshots (route_id, time DESC);

-- What ETA Spot predicted, as of `time` (when we asked).
CREATE TABLE IF NOT EXISTS eta_predictions (
  time               timestamptz NOT NULL,
  stop_id            integer     NOT NULL,
  route_id           integer     NOT NULL,
  trip_key           text        NOT NULL,  -- ETA Spot scheduleNumber
  vehicle_id         text,                  -- null when no bus is assigned yet
  predicted_arrival  timestamptz NOT NULL,
  minutes            integer     NOT NULL,
  source             text        NOT NULL   -- 'stop_etas' | 'vehicle'
);
SELECT create_hypertable('eta_predictions', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS eta_predictions_stop_trip ON eta_predictions (stop_id, trip_key, time DESC);
CREATE INDEX IF NOT EXISTS eta_predictions_vehicle ON eta_predictions (vehicle_id, stop_id, time DESC);

-- Derived: a bus was within ~30 m of a stop on its route.
CREATE TABLE IF NOT EXISTS stop_arrivals (
  time        timestamptz      NOT NULL,
  vehicle_id  text             NOT NULL,
  route_id    integer          NOT NULL,
  stop_id     integer          NOT NULL,
  distance_m  real             NOT NULL
);
SELECT create_hypertable('stop_arrivals', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS stop_arrivals_unique ON stop_arrivals (vehicle_id, stop_id, time);
CREATE INDEX IF NOT EXISTS stop_arrivals_route_stop ON stop_arrivals (route_id, stop_id, time DESC);

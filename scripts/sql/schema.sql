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

-- Derived by the poller: travel time between consecutive stops a bus reached.
CREATE TABLE IF NOT EXISTS segment_times (
  time        timestamptz NOT NULL,  -- arrival at to_stop
  vehicle_id  text        NOT NULL,
  route_id    integer     NOT NULL,
  from_stop   integer     NOT NULL,
  to_stop     integer     NOT NULL,
  seconds     real        NOT NULL
);
SELECT create_hypertable('segment_times', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS segment_times_unique ON segment_times (vehicle_id, to_stop, time);

-- Derived by the poller at each arrival: how far off ETA Spot's prediction was,
-- for the latest prediction made in each horizon bucket before the bus arrived.
CREATE TABLE IF NOT EXISTS prediction_errors (
  time               timestamptz NOT NULL,  -- actual arrival
  route_id           integer     NOT NULL,
  stop_id            integer     NOT NULL,
  vehicle_id         text        NOT NULL,
  horizon_min        smallint    NOT NULL,  -- 2, 5 or 10: lower bound of the bucket
  predicted_at       timestamptz NOT NULL,
  predicted_arrival  timestamptz NOT NULL,
  error_sec          real        NOT NULL   -- actual - predicted (positive = bus was late)
);
SELECT create_hypertable('prediction_errors', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS prediction_errors_unique ON prediction_errors (vehicle_id, stop_id, horizon_min, time);

-- Continuous aggregates (real-time: recent raw rows are included until materialized).
CREATE MATERIALIZED VIEW IF NOT EXISTS segment_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', time) AS bucket, route_id, from_stop, to_stop,
       avg(seconds) AS avg_seconds, count(*) AS n
FROM segment_times
GROUP BY bucket, route_id, from_stop, to_stop
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS lateness_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', time) AS bucket, route_id, horizon_min,
       avg(error_sec) AS avg_error_sec, avg(abs(error_sec)) AS avg_abs_error_sec, count(*) AS n
FROM prediction_errors
GROUP BY bucket, route_id, horizon_min
WITH NO DATA;

SELECT add_continuous_aggregate_policy('segment_hourly',
  start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '10 minutes',
  if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('lateness_hourly',
  start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '10 minutes',
  if_not_exists => TRUE);

-- Compression keeps a weekend of data far below free-tier storage (typically 90%+ smaller).
-- Chunks are compressed once they're 6 hours old; queries and inserts still work on them.
-- Wrapped so re-running the schema never fails on already-configured tables.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('vehicle_snapshots', 'vehicle_id'), ('eta_predictions', 'stop_id'), ('stop_arrivals', 'vehicle_id'),
    ('segment_times', 'route_id'), ('prediction_errors', 'route_id')) AS v(tbl, seg)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I SET (timescaledb.compress, timescaledb.compress_segmentby = %L, timescaledb.compress_orderby = %L)',
        t.tbl, t.seg, 'time DESC');
    EXCEPTION WHEN others THEN RAISE NOTICE 'compression settings for % unchanged: %', t.tbl, SQLERRM;
    END;
    PERFORM add_compression_policy(t.tbl::regclass, INTERVAL '6 hours', if_not_exists => TRUE);
  END LOOP;
END $$;

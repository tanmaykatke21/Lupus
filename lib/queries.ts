// SQL shared by the app, the poller and scripts. Plain Postgres except where noted.

/** Called once per detected arrival: stores ETA Spot's error for each horizon bucket. */
export const INSERT_PREDICTION_ERRORS = `
INSERT INTO prediction_errors (time, route_id, stop_id, vehicle_id, horizon_min, predicted_at, predicted_arrival, error_sec)
SELECT DISTINCT ON (h.horizon_min)
       $1::timestamptz, $2::int, $3::int, $4::text, h.horizon_min, p.time, p.predicted_arrival,
       EXTRACT(EPOCH FROM ($1::timestamptz - p.predicted_arrival))
FROM eta_predictions p
JOIN (VALUES (2, 5), (5, 10), (10, 20)) AS h(horizon_min, horizon_max)
  ON p.time <= $1::timestamptz - make_interval(mins => h.horizon_min)
 AND p.time >  $1::timestamptz - make_interval(mins => h.horizon_max)
WHERE p.stop_id = $3 AND p.vehicle_id = $4
ORDER BY h.horizon_min, p.time DESC
ON CONFLICT DO NOTHING`;

/** Average stop-to-stop seconds by campus hour of day, last 21 days (reads the continuous aggregate). */
export const SEGMENT_AVERAGES = `
SELECT route_id, from_stop, to_stop,
       EXTRACT(HOUR FROM bucket AT TIME ZONE 'America/New_York')::int AS hour,
       (sum(avg_seconds * n) / sum(n))::float AS avg_seconds,
       sum(n)::int AS n
FROM segment_hourly
WHERE bucket > now() - INTERVAL '21 days'
GROUP BY 1, 2, 3, 4`;

/** Mean lateness vs ETA Spot (5-10 min horizon) by route and campus hour of day. */
export const LATENESS_BY_HOUR = `
SELECT route_id,
       EXTRACT(HOUR FROM bucket AT TIME ZONE 'America/New_York')::int AS hour,
       (sum(avg_error_sec * n) / sum(n))::float AS avg_error_sec,
       sum(n)::int AS n
FROM lateness_hourly
WHERE horizon_min = 5 AND bucket > now() - INTERVAL '21 days'
GROUP BY 1, 2`;

/** Rows for the accuracy study, oldest first. */
export const ACCURACY_ROWS = `
SELECT time, route_id, stop_id, horizon_min, predicted_arrival, error_sec,
       EXTRACT(HOUR FROM time AT TIME ZONE 'America/New_York')::int AS hour
FROM prediction_errors
ORDER BY time`;

/** Recorded window for replay: the busiest stretch of the most recent recorded day. */
export const REPLAY_RANGE = `
SELECT min(time) AS start, max(time) AS "end", count(DISTINCT vehicle_id)::int AS vehicles
FROM vehicle_snapshots
WHERE in_service AND time > (SELECT max(time) FROM vehicle_snapshots) - INTERVAL '24 hours'`;

/** Latest recorded position per bus at a replay instant. */
export const REPLAY_POSITIONS = `
SELECT DISTINCT ON (vehicle_id) vehicle_id, route_id, lat, lng, heading, next_stop_id, load, time
FROM vehicle_snapshots
WHERE in_service AND time <= $1::timestamptz AND time > $1::timestamptz - INTERVAL '2 minutes'
ORDER BY vehicle_id, time DESC`;

/** Latest recorded prediction per trip at a stop, as of a replay instant. */
export const REPLAY_STOP_ETAS = `
SELECT DISTINCT ON (trip_key) route_id, trip_key, vehicle_id, predicted_arrival, time
FROM eta_predictions
WHERE stop_id = $1 AND time <= $2::timestamptz AND time > $2::timestamptz - INTERVAL '3 minutes'
  AND predicted_arrival >= $2::timestamptz
ORDER BY trip_key, time DESC`;

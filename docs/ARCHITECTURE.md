# Architecture

## Components

1. **Python collector** — fetches ThemeParks.wiki live/history data and Open-Meteo weather, normalizes observations, and upserts hourly SQLite rows.
2. **SQLite** — stores park-level and ride-level observations. Runtime databases are not committed.
3. **ML pipeline** — builds temporal/calendar/weather features and exports daily crowd and hourly wait estimates.
4. **Express API** — serves realtime, observed history, prediction, and route endpoints. It can manage the collector as a child process.
5. **Taro/React Mini Program** — consumes the API and maintains personal check-in/ledger state on-device.

## API surface

| Endpoint | Meaning |
| --- | --- |
| `GET /health` | Service, collector configuration, and data coverage |
| `GET /api/realtime` | Latest timestamped observed snapshot |
| `GET /api/history?limit=60` | Daily aggregates from observed rows |
| `GET /api/predict?start=&end=` | Model-estimated date rankings |
| `GET /api/suggest?date=` | Model-estimated time-slot route |

## Failure behavior

- Failed collection never advances the observation timestamp.
- Stale snapshots are labeled using their original capture time.
- The Mini Program falls back to its last bundled snapshot when the API is unavailable.
- Observations and predictions use different language and visual labels.
- Personal data remains local and is not overwritten by public-data migrations.

## Key design decisions

- **Hourly upsert:** polling occurs every five minutes, while the database keeps the latest observation for each hour instead of silently retaining the first.
- **Separated targets:** crowd index and attraction wait time are modeled independently; low crowd does not imply every attraction has a short queue.
- **Bounded hosting:** the application can be deployed for a time-boxed observation campaign and archived without pretending to be an ongoing service.
- **Offline honesty:** offline usability is retained, but freshness and provenance remain visible.

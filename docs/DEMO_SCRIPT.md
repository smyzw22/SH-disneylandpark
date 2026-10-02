# 60–90 Second Demo Script

## Recording setup

- Record a phone preview from WeChat DevTools or a real-device preview build.
- Use a fixed demo dataset or a known timestamped live snapshot to avoid unpredictable interruptions.
- Add a two-second title card: “Personal portfolio prototype — observed data + clearly labeled model estimates.”
- Blur developer account identifiers, API keys, QR codes, and personal ledger/check-in content.

## Shot list

| Time | Action | Voice-over / caption |
| ---: | --- | --- |
| 0–8 s | Open **Today** and show source/freshness label | “The app separates observed park status from cached or stale data.” |
| 8–20 s | Scroll several rides and refresh | “A Python collector normalizes attraction waits and stores hourly SQLite snapshots.” |
| 20–34 s | Open **Forecast**, switch crowd/wait ranking | “XGBoost estimates daily crowd, while an independent LSTM estimates attraction waits.” |
| 34–46 s | Tap a date into **Route** | “The API converts model output into time-slot advice and a suggested sequence.” |
| 46–60 s | Open **Check-in** atlas/map and a statistic detail | “The product layer adds a visit calendar, attraction atlas, map, and detailed check-in history.” |
| 60–72 s | Open **My Park** ledger/data archive | “Ticket and in-park spending are separated, and observed-data coverage remains visible.” |
| 72–90 s | Show architecture + GitHub README | “The repository documents provenance, synthetic-data limits, deployment, and reproducibility.” |

## Required disclosure in the video description

> Current-condition screens use real API observations when the backend is online. Forecast screens are model estimates. The checked-in training dataset is synthetic and schema-aligned; metrics are prototype results, not production accuracy claims.

## Screenshots to capture

1. Today page with source and timestamp visible.
2. Forecast ranking with “prediction” disclosure visible.
3. Route timeline.
4. Check-in atlas/map detail.
5. My Park ledger/data archive.
6. Architecture diagram.
7. Model metrics table with synthetic-data caveat.

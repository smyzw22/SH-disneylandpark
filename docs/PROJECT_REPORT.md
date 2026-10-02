# Project Report: Shanghai Disneyland Crowd Intelligence Mini Program

## 1. Problem and scope

Planning a theme-park visit combines two different questions: *Which day is likely to be less crowded?* and *What should I do at each hour once I arrive?* A useful product must also handle unreliable network access, attraction closures, changing API coverage, and the fact that overall attendance does not map directly to every ride's queue.

This project is a personal portfolio prototype that studies the complete engineering path from data collection to a mobile interface. It is not an official Disney product and is not intended to operate indefinitely. The target outcome is a reproducible system and a bounded real-data deployment that demonstrates engineering decisions, ML experimentation, and product thinking.

## 2. System design

The system contains five layers:

1. A Python collector fetches attraction status/history from ThemeParks.wiki and weather from Open-Meteo.
2. SQLite stores park-level and ride-level hourly observations.
3. An ML pipeline creates temporal, calendar, and weather features for two independent targets.
4. An Express API exposes realtime, history, prediction, and route endpoints.
5. A Taro/React WeChat Mini Program provides five task-oriented areas: Today, Forecast, Check-in, Route, and My Park.

The API starts the collector by default. It performs an immediate live request, reconstructs the available history window, and continues polling every five minutes. Rows are keyed by date/hour/ride; later polls update the current hour rather than being discarded by a uniqueness constraint.

## 3. Data and modeling

The system distinguishes observations from experimental training data. Online/current screens use real API observations and preserve their capture timestamp. The checked-in model-training CSVs are synthetic and aligned to the collector schema. This allows the entire feature-training-export-client pipeline to be reproduced without redistributing an unreviewed operational database, but it does not support a claim of real-world accuracy.

The crowd model uses XGBoost regression to estimate a daily crowd index. The wait model uses an LSTM to estimate hourly attraction waits. They are intentionally independent because a relatively quiet park can still contain a highly concentrated queue at a popular attraction.

On the current synthetic experiment split, XGBoost has MAE 4.30 and RMSE 5.31; the LSTM has MAE 3.73 minutes and RMSE 4.64 minutes. These metrics demonstrate pipeline behavior only. A real-data evaluation should use chronological splits, seasonal baselines, per-attraction error analysis, missingness reporting, and uncertainty intervals.

## 4. Product and interaction design

The information architecture separates five user intents rather than repeating crowd charts across tabs. Today owns observations; Forecast owns future estimates; Check-in owns personal memories; Route owns date-specific action planning; My Park owns accounting and the data archive.

The product treats freshness as part of the interface. Failed requests do not silently update timestamps. Cached snapshots show the original capture time and an offline/stale label. Forecast and route screens explicitly state that results are estimates. Check-ins and ledger entries remain local to the user's device.

The ledger was redesigned so total spending equals ticket spending plus in-park spending. Annual-pass break-even analysis is optional and no longer controls whether ordinary expenses are preserved. Atlas statistics open exact visit-date and item-level details, and the map catalog covers attractions, shows, and characters.

## 5. Deployment experiment

Long-term hosting is not necessary for the portfolio objective. A one-month cloud experiment is sufficient to demonstrate HTTPS deployment, persistent storage, live collection, monitoring, error handling, and real-device use. At the end of the month, the database can be archived privately, coverage statistics can be published, the demo can be recorded, and paid compute can be stopped.

The repository provides Docker and Compose definitions with a persistent SQLite volume. Secrets remain server-side. The public Mini Program configuration uses a tourist AppID, and runtime databases, private WeChat config, upload bundles, dependencies, and API keys are excluded from Git.

## 6. Limitations and next steps

The largest limitation is the lack of a sufficiently long real training/evaluation dataset. Other limitations include dependence on third-party APIs, incomplete operational covariates, possible catalog/schema change, no prediction intervals, and limited automated interaction testing.

The next research iteration would collect a permission-compliant real observation window, quantify missingness, introduce seasonal-median baselines, evaluate with rolling-origin splits, and measure errors by attraction and hour. On the product side, accessibility tests, real-device studies, and drift/freshness monitoring would provide more value than adding another complex model prematurely.

## 7. Learning outcomes

The project demonstrates full-stack ownership, but its most important lesson is epistemic: observed data, cached data, synthetic experiments, and predictions must remain distinguishable. Treating provenance and uncertainty as product requirements made the system more credible than a visually polished dashboard that hides where its numbers came from.

# Mini Program Developer Guide

The client is built with Taro 4, React, TypeScript, NutUI, and SCSS.

## Commands

```bash
npm ci
npm run dev:weapp     # watch mode for WeChat DevTools
npm run build:weapp   # production WeChat build
npm run build:h5      # browser build for UI review
```

Open this `miniprogram/` directory in WeChat DevTools. `project.config.json` points DevTools to `dist/` and uses `touristappid` for public-repository safety. Replace it locally with an authorized AppID before previewing or uploading; keep the private value out of Git.

## API configuration

The client defaults to `http://127.0.0.1:3000` for local development. Build against a deployed API with:

```bash
TARO_APP_API_BASE=https://your-api.example.com npm run build:weapp
```

Production WeChat requests require HTTPS and the same hostname in the Mini Program's legal `request` domains.

## Navigation ownership

- `Today`: observed/stale-aware current status.
- `Forecast`: model estimates and rankings.
- `Check-in`: visit, atlas, and map interactions.
- `Route`: date-specific model recommendation.
- `My Park`: ledger and observed-data archive.

The UI deliberately labels observed, estimated, cached, stale, and offline states separately.

# 上海迪士尼乐园人流预测与游园助手

这是一个用于计算机科学研究生申请作品集的端到端工程原型，包含微信小程序、真实数据采集、Express API、SQLite 数据存储、XGBoost/LSTM 预测管线，以及打卡、地图和账本等产品功能。

## 项目定位

本项目不需要长期商业化运营。更合适的展示方式是：租用约一个月云服务器，完成真实数据采集、HTTPS 部署、微信真机体验和故障监控，录制演示视频后停止付费服务，同时保留完整本地复现能力。

## 必须说明的数据边界

- “今日”页面在线时读取 ThemeParks.wiki 的真实设施状态和排队数据，并保留原始时间戳。
- 天气来自 Open-Meteo。
- 预测和路线始终是模型估计，不等于真实未来数据。
- 仓库中的模型训练 CSV 是 `synthetic_aligned_to_scraper_schema`，即按爬虫数据库结构生成的合成实验数据。
- 当前 MAE/RMSE 仅证明特征、训练、评估、导出和前端消费链路可以运行，不能作为真实乐园泛化性能结论。
- API 不可用时，小程序展示带采集时间的离线快照，并明确标注“离线/过期”，不伪装成实时数据。

详细说明见：[Data Card](docs/DATA_CARD.md)、[Model Card](docs/MODEL_CARD.md) 和 [Architecture](docs/ARCHITECTURE.md)。

## 五个产品模块

- 今日：真实/离线状态、设施排队、天气、数据新鲜度。
- 预测：未来 30 天人流与热门项目排队估计，分别排名。
- 打卡：入园日历、设施/演出/角色图鉴、地图、笔记与照片。
- 路线：按日期生成分时避峰建议与项目顺序。
- 我的：票务和园内消费账本、真实数据档案。

## 快速运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-ml.txt

cd server
npm ci
npm start
```

另开终端构建小程序：

```bash
cd miniprogram
npm ci
npm run build:weapp
```

在微信开发者工具中打开 `miniprogram/`。公开仓库默认使用 `touristappid`，如需上传请替换为自己的 AppID。

## 申请作品集建议

最有价值的材料不是长期在线地址，而是以下证据组合：

1. 60–90 秒真机演示视频；
2. 3–5 张界面、预测、架构和模型结果截图；
3. 2–4 页项目报告；
4. 清晰的数据来源、合成数据、模型局限和失败降级说明；
5. 一个可复现、无密钥、结构清楚的 GitHub 仓库；
6. 一个月真实采集活动的归档统计与运行日志摘要。

拍摄脚本见 [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)，项目报告素材见 [`docs/PORTFOLIO_NOTES.md`](docs/PORTFOLIO_NOTES.md)。

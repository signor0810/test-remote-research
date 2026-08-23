# AI 工作流事件層 · 系統架構與使用習慣

把 `cursor-cli` / `hermes` / `sng-ap` 三個 AI 工具、Jira / Confluence、Outlook 的紀錄，
正規化成單一事件流，用來**自動產生週報**，並**持續找出可自動化的環節**。

## 核心設計主張

1. **統一事件層優先於報表**：週報只是事件流的一種投影。先把資料正規化，報表就變成便宜的下游。
2. **Jira issue key 是唯一關聯鍵**：分支、commit、AI session、Confluence 頁面都帶上它。這是投報率最高的一項改變。
3. **friction 要當下記，不能事後挖**：浪費時間的事通常不留痕跡，所以它必須是事件的一等公民。
4. **敏感度邊界決定架構**：`sng-ap` 是內部無外網工具，因此合成層應跑在內部邊界內，對外只交付成品。
5. **習慣先行，程式碼後補**：Phase 0 完全不寫程式就該看到效果；看不到就別蓋系統。

## 文件

| 文件 | 內容 |
|---|---|
| [`docs/01-architecture.md`](docs/01-architecture.md) | 分層架構、事件模型、三工具路由策略、週報流程、風險 |
| [`docs/02-usage-habits.md`](docs/02-usage-habits.md) | 使用習慣 SOP（依投報率排序）、每週節奏 |
| [`docs/03-roadmap-metrics.md`](docs/03-roadmap-metrics.md) | 分階段導入、成效指標、失敗訊號 |
| [`docs/schema/work-event.schema.json`](docs/schema/work-event.schema.json) | `WorkEvent` JSON Schema |
| [`docs/templates/weekly-report.md`](docs/templates/weekly-report.md) | Confluence 週報模板（固定 anchor） |

## 今天就能開始的四件事

1. 分支 / commit / AI session 開場白 / Confluence 標題，一律帶 Jira key。
2. 一個任務一個 session，不跨 issue。
3. 每個 session 結束前丟一句：`用三行總結：1) 做了什麼 2) 產出連結 3) 卡在哪`
   （**hermes 沒有自動摘要，這步對它是必要的，不是可選的**）。
4. 卡住超過 25 分鐘，在 `friction.md` 記一行。

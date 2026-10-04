# herdr-bridge

一個 Claude Code Mod：把特定的工具呼叫轉交給其他 agent 處理（agy、跑 Qwen3.8 的 pi 或 hermes、或直接呼叫本地模型 API），並記錄 Claude 這一側的 token 用量，方便你做 A/B 比較，確認轉交到底有沒有省到。

```
Claude Code ──tool.call──▶ herdr-bridge ──┬─ herdr ──▶ agy（網路搜尋、YouTube）
                                           ├─ herdr ──▶ pi / hermes + Qwen3.8（大型 EDA 報告）
                                           ├─ http  ──▶ LM Studio / Ollama / vLLM 的 OpenAI 相容 API
                                           └─ exec  ──▶ 任何 CLI（例如 agy -p）
```

需要 Claude Code v2.1.287 以上，並且在本機的終端機執行（`$.process.run` 只在 CLI 可用）。

## 它做什麼

| 功能 | 觸發時機（事件） | 行為 |
|---|---|---|
| 網路搜尋轉交 | `tool.call`（WebSearch） | 不跑 Claude 自己的搜尋，改請 agent 搜尋，把它的摘要當成搜尋結果交回給 Claude |
| YouTube 轉交 | `tool.call`（WebFetch，網址符合 `urlPattern`） | 交給 agy 看影片，回答 Claude 原本想問的問題 |
| 大型報告摘要 | `tool.call`（Read，路徑符合 `pathPattern` 且檔案大於 `minBytes`） | 交給本地模型讀，Claude 只拿到摘要；之後若 Claude 用 `offset`／`limit` 讀指定行數，照常讀原檔 |
| Token 記錄 | `turn.start`、`turn.step`、`tool.call`、`turn.complete` | 每一輪寫一行 JSON 到記錄檔（ledger）：Claude 的 input、output、cache 用量、工具回傳的字數、每次轉交的耗時與結果 |
| 資訊列 | `ui.render`（`AbovePrompt`） | 在輸入框上方顯示本 session 的用量和轉交次數，附一個 Turn off／Turn on 按鈕 |
| `/bridge` | `command.run` | 切換開關、設定 A/B 標籤、看統計 |
| `/ask <agent> <prompt>` | `command.run` | 直接問某個 agent，不開啟 Claude 的一輪對話 |

**失敗就退回**：agent 出錯、逾時、或沒有交回任何內容時，這次呼叫會改跑 Claude 原本的工具，並在對話中留下一行灰字說明原因。不在 herdr 裡面時，herdr 類型的 route 一律直接跑原本的工具。

## 安裝

```bash
# 1. 放好設定檔（擇一）
cp herdr-bridge.example.json ~/.claude/herdr-bridge.json          # 所有專案共用
cp herdr-bridge.example.json <專案>/.claude/herdr-bridge.json      # 只用在這個專案（優先）

# 2. 在 herdr 的一個 pane 裡啟動 Claude Code，載入這個 Mod
claude --plugin-dir /path/to/mods/herdr-bridge

# 3. 確認載入狀態
/bridge
```

`/bridge` 會列出：目前模式、讀到的設定檔、設定錯誤、是否在 herdr 裡、所有 route，以及記錄檔的位置。

## 先確認這三件事

1. **herdr 的 agent kind 名稱**。範例裡的 `antigravity`、`pi` 是我推測的名稱，herdr 實際支援的 kind 請用 `herdr agent start --help` 確認後修改。如果 herdr 不支援你的 agent，可以改用 `exec`：例如 `"argv": ["agy", "-p", "{prompt}"]`。
2. **pi 或 hermes 指定 Qwen 的參數**。範例的 `"startArgs": ["--model", "qwen3.8-27b"]` 會接在 `herdr agent start ... --` 後面傳給 agent，請改成你實際使用的參數。如果只需要「讀檔、出摘要」，也可以直接用 `qwen-api`（http），不必經過 agent。
3. **只把機密檔案交給本地模型**。`eda-report` 這類 route 會把檔案路徑或內容交給 agent。受 NDA 保護的報告，route 的 `agent` 只能指向本地的 Qwen，不要指向 agy。

## 設定檔

```jsonc
{
  "agents": {
    "<名稱>": { "transport": "herdr", "kind": "<herdr kind>", "startArgs": ["..."], "direction": "right" },
    "<名稱>": { "transport": "http", "baseUrl": "http://localhost:1234/v1", "model": "...", "maxTokens": 2048, "system": "...", "useApiKey": false },
    "<名稱>": { "transport": "exec", "argv": ["cmd", "{prompt}"] }   // argv 裡沒有 {prompt} 時，prompt 從 stdin 送入
  },
  "routes": [
    { "name": "...", "tool": "WebSearch | WebFetch | Read", "agent": "<名稱>", "prompt": "...",
      "urlPattern": "WebFetch 用的正規表示式", "pathPattern": "Read 用的正規表示式", "minBytes": 200000, "enabled": true }
  ],
  "timeoutMs": 300000,      // 單次轉交的上限（herdr／exec 最多 10 分鐘）
  "maxResultChars": 8000,   // 交回給 Claude 的字數上限，這個值直接影響省多少
  "maxInputChars": 200000,  // prompt 裡用了 {content} 時，最多塞入多少檔案內容
  "weights": { "input": 1, "output": 5, "cacheRead": 0.1, "cacheWrite": 1.25 }
}
```

**prompt 可用的佔位符**：`{query}`（搜尋字串）、`{url}`、`{question}`（Claude 對 WebFetch 下的指示）、`{path}`、`{content}`（檔案內容，http agent 讀不到你的檔案時使用）、`{out}`（請 agent 把答案寫到這個檔案）。

**用檔案交接答案**：herdr 和 exec 類型的 agent，請在 prompt 裡要求它「把答案寫到 {out}」，Mod 會讀這個檔案。沒有這個檔案時，herdr 會改讀 agent pane 上最近的輸出，exec 則讀 stdout，但這兩種內容通常比較雜。

**同一個工具有多個 route 時**，由上往下取第一個條件符合的。

**多個轉交同時進行時**，每個 agent 名稱只會開一個 pane，第一次用到時自動開啟。

設定檔改了之後，執行 `/bridge reload` 重新讀取。

## A/B 比較：到底有沒有省

記錄檔放在 `~/.claude/herdr-bridge/ledger/<session id>.jsonl`，每一輪一行。

建議的比較流程：拿同一個研究問題各跑一次，或各跑幾次取平均。

```
/bridge tag research-1    # 標籤
/bridge on                # 開啟轉交
（問問題，等它做完）
/clear
/bridge off               # 關閉：全部跑原本的工具，但照樣記錄
（問同一個問題）
/bridge stats research-1
```

`/bridge stats` 的輸出：

| tag | mode | turns | weighted / turn (mean) | weighted / turn (median) | output / turn | seconds / turn | delegations | delegate tokens |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| research-1 | off | 1 | 182.4k | 182.4k | 3.1k | 95.0 | 0 | 0 |
| research-1 | on | 1 | 61.7k | 61.7k | 2.2k | 140.2 | 4 | 0 |

（表中數字只是示意。）

**怎麼解讀這些數字**

- **weighted（加權 token）**：把 Claude 的四種 token 換算成同一個單位。預設權重是 input 1、output 5、cache read 0.1、cache write 1.25，比例依照 API 的價格。用訂閱方案的話，額度怎麼計算 Anthropic 沒有公開，請把這個數字當成「相對成本」來比較，不要當成實際花費。權重可以在設定檔的 `weights` 修改。
- **為什麼要看「每輪」而不是單次請求**：轉交真正省下的，常常是 Claude 少跑了幾圈工具迴圈。每一圈都要把整段 context 重送一次（cache read）。所以要比較整輪的總量。
- **delegate tokens**：只有 http transport 會回報（取自 OpenAI 相容 API 的 `usage`）。herdr 和 exec 不會回報，那一側的成本要去 agy 或 pi 自己的用量頁面查看。
- **seconds / turn**：轉交通常比較慢。你用 Claude 的 token 換到的是時間成本，以及 agy 的額度。
- 每一輪的完整記錄還包含各工具的呼叫次數和回傳字數（`tools`），以及每次轉交的耗時和成功與否（`delegations`），可以用 `jq` 自行分析：

```bash
cat ~/.claude/herdr-bridge/ledger/*.jsonl | jq -s 'group_by(.mode) | map({mode: .[0].mode, turns: length, weighted: (map(.weighted) | add)})'
```

## 已知的限制

- **攔截 Read 的副作用**：Claude Code 規定改檔前必須先 Read 過該檔。被 Mod 換成摘要的 Read，不算真正讀過，所以 Claude 若要編輯這個檔案，會先用 `offset`／`limit` 重新讀，這時會照常讀原檔。報告和 log 通常不需要編輯，影響不大。
- **agy 抓回來的內容是不可信的網頁資料**，會直接進入 Claude 的 context，風險和 Claude 自己搜尋時一樣。
- **mode 是共用的設定**：`/bridge on|off` 會寫進 Mod 的 store，所有 session 共用。
- **交接檔案不會自動刪除**：`~/.claude/herdr-bridge/out/` 會一直累積（Mod API 沒有刪檔功能），偶爾手動清一下即可。
- **只在本機終端機有效**：VS Code 擴充套件裡 hook 會執行，但看不到資訊列；`claude -p` 也一樣。雲端 session 沒有 herdr，也沒有你的本地模型。

## 開發

```bash
claude plugin validate .   # 列出 Mod 會掛哪些事件、呼叫哪些 $ 能力、讀哪些環境變數
claude plugin test .       # 11 個測試：在記憶體裡模擬 herdr、本地模型 API 和檔案系統
```

| 檔案 | 內容 |
|---|---|
| `hooks/register.tsx` | 所有 hook，以及所有會呼叫 `$` 的函式。validator 只追蹤同一個檔案裡的 `$` 呼叫，所以它們都放在這裡 |
| `hooks/config.ts` | 設定檔的型別、驗證和預設值（純函式） |
| `hooks/transports.ts` | herdr、exec、http 三種方式的參數組裝與回應解析（純函式） |
| `hooks/ledger.ts` | 用量加總、加權計算和統計表（純函式） |
| `types/index.d.ts` | `$.state` 的型別合約 |

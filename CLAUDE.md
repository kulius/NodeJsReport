# NodeJsReport - Node.js 印表機控制服務

## 定位

本機 Node.js 列印服務（port 39500），提供 REST API + Web UI。
解決 Odoo ERP 無法直接列印 + 無法套印預印表單的問題。

## 技術棧

| 用途 | 套件 |
|------|------|
| Web 框架 | Express |
| 目錄監測 | chokidar |
| Excel 讀取 | exceljs |
| PDF 列印 | pdf-to-printer (SumatraPDF) |
| 報表產生 | pdfmake |
| 套印引擎 | pdf-lib |
| ESC/P 指令 | 自建 (net.Socket + Buffer) |
| 即時通知 | Socket.IO |
| 驗證 | Zod |
| 日誌 | Pino |
| CJK 字型 | NotoSansTC |

## 快速啟動

```bash
cd /d/odooai/workspaces/NodeJsReport
npm install
npm run dev
# http://localhost:39500
```

## 專案結構

```
src/
  index.ts          # Express + Socket.IO 入口
  config.ts         # 環境設定
  routes/           # API 路由
  services/         # 業務邏輯
  models/           # TypeScript 型別
  validators/       # Zod schema
  utils/            # 工具函式
public/             # Web UI (靜態檔案)
data/               # 執行期資料 (templates, fonts, uploads, output)
```

## API 端點

| Method | Path | 說明 |
|--------|------|------|
| GET | /api/health | 健康檢查 |
| GET | /api/printers | 列出印表機 |
| POST | /api/print | PDF 直接列印 |
| POST | /api/report | JSON 報表 → PDF |
| POST | /api/overlay | 套印列印 |
| CRUD | /api/templates | 套印範本管理 |
| GET | /api/preview/:id | PDF 預覽 |
| GET | /api/jobs | 列印工作紀錄 |
| GET | /api/paper-sizes | 紙張大小 |
| POST | /api/watcher/start | 開始目錄監測 |
| POST | /api/watcher/stop | 停止目錄監測 |
| GET | /api/watcher/status | 監測狀態 |
| POST | /api/excel/print | Excel 上傳列印 |
| POST | /api/excel/preview | Excel 上傳預覽 |
| GET | /api/updater/check | 檢查 GitHub 新版 |
| POST | /api/updater/apply | 下載並套用更新 |
| GET | /api/updater/status | 更新狀態 |

## 重要檔案

| 檔案 | 說明 |
|------|------|
| src/services/printer.service.ts | 印表機列舉 + PDF 列印 |
| src/services/watcher.service.ts | chokidar 目錄監測 |
| src/services/excel.service.ts | Excel → PDF 轉換 |
| src/services/escp.service.ts | ESC/P 指令 (點陣印表機) |
| src/services/report.service.ts | pdfmake 報表引擎 |
| src/services/overlay.service.ts | pdf-lib 套印引擎 |
| src/services/template.service.ts | 範本 CRUD |
| src/services/updater.service.ts | GitHub 自動更新 |
| public/overlay-designer.html | 視覺化套印設計器 |

## CJK 字型設定

下載 NotoSansTC 到 `data/fonts/`:
```bash
# Regular
curl -L -o data/fonts/NotoSansTC-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
```

## EXE 打包

使用 `@yao-pkg/pkg` 打包成 Windows 獨立執行檔，客戶端不需安裝 Node.js。

```bash
# 打包（輸出到 build/nodejs-report.exe）
npm run pkg

# 打包後測試
npm run pkg:run
```

### 客戶端部署結構

```
D:\NodeJsReport\
├── nodejs-report.exe      # 打包後的 exe
├── .env                    # 使用者設定（可選）
└── data/
    ├── fonts/              # NotoSansTC 字型
    ├── templates/          # 套印範本
    ├── uploads/            # 上傳暫存
    ├── output/             # PDF + 更新暫存
    ├── paper-sizes.json
    └── watcher-config.json
```

### 路徑處理

- `config.ts` 會偵測 `process.pkg` 判斷是否為打包環境
- 打包後 `data/` 路徑以 exe 所在目錄為基底
- `public/` 靜態檔案打包進 exe 內部 snapshot filesystem

## 自動更新

儀表板 Header 有「檢查更新」按鈕，從 GitHub Releases 檢查新版。

### 更新流程

1. 點擊「檢查更新」→ 呼叫 GitHub Releases API
2. 比較 tag_name vs package.json version
3. 有新版 → 顯示版本 + Release Notes
4. 點擊「下載並更新」→ 下載 exe → PowerShell 腳本替換 → 自動重啟

### 發佈新版

1. 更新 `package.json` version
2. `npm run pkg` 產出 exe
3. GitHub 建立 Release (tag `vX.Y.Z`)，附上 `nodejs-report.exe`

## 開發注意事項

- Port 39500（不要改，Odoo 模組會用）
- Windows 專用（pdf-to-printer 依賴 SumatraPDF）
- 資料存 data/ 目錄（JSON 檔），不用資料庫
- ESC/P 模式只適用點陣印表機（EPSON LQ 系列）
- 打包用 `@yao-pkg/pkg`（vercel/pkg 社群 fork）

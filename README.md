# HomeSplit — 家庭收支平台

單一 HTML 檔案的家庭收支／分帳工具，風格與操作參考 [KittySplit](https://www.kittysplit.com/)。  
資料會同步寫入**本 GitHub 專案**的 JSON 與 XML，兩人開啟同一個網頁時會自動讀取最新紀錄。

## 立即使用

1. 啟用 GitHub Pages（Settings → Pages → Source = **GitHub Actions**），或用瀏覽器直接開啟 [`index.html`](./index.html)
2. 網站網址（Pages 啟用後）：`https://aamonster2026.github.io/HomeSplit/`
3. 兩人用**同一個網址**開啟即可自動載入 `data/homesplit.json`

本機 `localStorage` 仍會備份一份，離線時可繼續查看。

## 網路儲存（同一專案）

建立兩人 Kitty 後，紀錄會寫入本倉庫：

| 檔案 | 說明 |
| --- | --- |
| [`data/homesplit.json`](./data/homesplit.json) | 完整資料（程式讀寫的主檔） |
| [`data/homesplit.xml`](./data/homesplit.xml) | 相同資料的 XML 鏡像 |

- **讀取**：公開倉庫無需 Token。開啟網頁會自動抓最新 JSON（GitHub Pages 同源或 `raw.githubusercontent.com`）。
- **寫入**：需要 Fine-grained Personal Access Token（只存在瀏覽器，**不會**寫進倉庫）。

### 建立 Token（建議 Fine-grained）

1. GitHub → Settings → Developer settings → [Personal access tokens](https://github.com/settings/tokens)
2. Fine-grained token → 只授權本倉庫 `AAMonster2026/HomeSplit`
3. Repository permissions → **Contents: Read and write**
4. 把 Token 貼到 HomeSplit 的「資料」或建立 Kitty 畫面（兩人都要貼，才能各自記帳並寫回）

Token 權限請盡量縮小，不要勾選整個帳號的刪除權限。

## 兩人共用流程

1. 其中一人建立 Kitty，並填入 Token → 資料寫入 `data/*.json` 與 `data/*.xml`
2. 另一人開啟同一 GitHub Pages 網址 → 自動讀到已建立的 Kitty 與支出
3. 之後任一方新增／編輯支出，有 Token 的一方會把變更推回倉庫
4. 另一人重新整理、切回分頁，或等待約 25–45 秒輪詢，即可看到更新

## 主要功能

- **建立 Kitty**：名稱、貨幣（HKD／TWD／CNY／USD／EUR／JPY）、兩位參與者
- **收入與夾錢**：本月家庭總收入、共同夾錢
- **支出紀錄**：金額、說明、日期、分類（膳食／日常用品／月費／其他）、付款人；可編輯刪除
- **即時計算**：每人總支出、分類總額、應收／應付、夾錢剩餘
- **Settle 結算**：淨收支與誰應付給誰；結算後開新月份並保留歷史
- **GitHub 同步**：JSON＋XML 存於同一 project；開啟網頁自動讀取
- **本機備份**：匯出 JSON／XML／TXT、匯入還原、清除資料
- **其他**：歷史月份、淺色／深色模式、列印摘要

## 分帳邏輯

- 每筆支出視為共同負擔，兩人各付一半
- 若 A 實際多付，則 B 應付差額給 A（反之亦然）
- 夾錢剩餘 = 夾錢金額 − 總支出

## 技術說明

- 純 HTML + CSS + 原生 JavaScript，無框架、無後端伺服器
- 以 [GitHub Contents API](https://docs.github.com/en/rest/repos/contents) 更新倉庫檔案
- CSS 變數集中在 `:root`，方便調整主題

## 檔案結構

```
index.html                      # 完整應用（CSS／JS 皆內嵌）
data/homesplit.json             # 網路同步主檔
data/homesplit.xml              # 網路同步 XML 鏡像
.github/workflows/pages.yml     # GitHub Pages 部署
README.md
```

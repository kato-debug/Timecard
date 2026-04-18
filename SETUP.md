# TimeCard セットアップガイド

## 構成ファイル

```
Timecard/
├── Code.gs          # Google Apps Script バックエンド
├── appsscript.json  # GAS マニフェスト
├── index.html       # フロントエンド（PWA）
├── sw.js            # Service Worker
├── manifest.json    # PWA マニフェスト
└── icons/           # アイコン画像（別途用意）
    ├── icon-192.png
    └── icon-512.png
```

---

## Step 1: Google スプレッドシートを準備する

1. [Google スプレッドシート](https://sheets.google.com) で新規シートを作成
2. スプレッドシートのURLからIDをコピー
   - URL例: `https://docs.google.com/spreadsheets/d/【ここがID】/edit`
3. シートを3つ作成（タブ名を正確に）
   - `master`
   - `log`
   - `summary`

### master シートのヘッダー行（1行目）
| id | employee_id | name | email | department | created_at | is_active |

### log シートのヘッダー行（1行目）
| id | employee_id | name | date | type | timestamp | latitude | longitude | address |

### summary シートのヘッダー行（1行目）
| employee_id | name | year | month | work_days | total_work_minutes | overtime_minutes | late_night_minutes | holiday_minutes | updated_at |

---

## Step 2: Google Apps Script をセットアップする

1. スプレッドシートのメニュー → **拡張機能 → Apps Script**
2. `Code.gs` の内容を貼り付け
3. `appsscript.json` を表示するには：
   - 左パネル「プロジェクトの設定」→「appsscript.json マニフェストファイルをエディタで表示する」にチェック
   - `appsscript.json` の内容を貼り付け
4. `Code.gs` の冒頭の `SPREADSHEET_ID` にStep1のIDを設定

```javascript
const SPREADSHEET_ID = 'あなたのスプレッドシートID';
```

---

## Step 3: 社員マスタを登録する

Apps Script エディタのコンソールで実行：

```javascript
// 例: 社員を追加する
addEmployee('山田 太郎', 'yamada@company.com', '営業部', 'EMP001');
addEmployee('鈴木 花子', 'suzuki@company.com', '開発部', 'EMP002');
```

または master シートに直接データを入力：
```
id          : 任意のUUID（自動生成も可）
employee_id : EMP001（社員番号）
name        : 山田 太郎
email       : yamada@company.com
department  : 営業部
created_at  : 2024-01-01 09:00:00
is_active   : TRUE
```

---

## Step 4: ウェブアプリとしてデプロイする

1. Apps Script エディタ → **デプロイ → 新しいデプロイ**
2. 種類：**ウェブアプリ**
3. 設定：
   - 説明: TimeCard API
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員（匿名ユーザーを含む）**
4. **デプロイ** をクリック
5. 表示された **ウェブアプリURL** をコピー

---

## Step 5: フロントエンドにURLを設定する

`index.html` を開き、冒頭のGAS_URLを設定：

```javascript
const GAS_URL = 'https://script.google.com/macros/s/【スクリプトID】/exec';
```

---

## Step 6: ウェブサーバーにデプロイする

### オプション A: GitHub Pages（無料）
1. リポジトリを作成（privateでも可）
2. `index.html`, `sw.js`, `manifest.json`, `icons/` をプッシュ
3. Settings → Pages → Source: main branch

### オプション B: Firebase Hosting
```bash
npm install -g firebase-tools
firebase init hosting
firebase deploy
```

### オプション C: 任意のWebサーバー
HTTPSが必要（Service Worker はHTTPS必須）

---

## Step 7: スマートフォンにインストール

### iOS (Safari)
1. Safariでアプリのリンクを開く
2. 下部の共有ボタン → **ホーム画面に追加**

### Android (Chrome)
1. Chromeでアプリのリンクを開く
2. メニュー → **ホーム画面に追加** または自動バナーをタップ

---

## アイコン作成

`icons/` フォルダに以下のPNGを用意：
- `icon-192.png` (192×192px)
- `icon-512.png` (512×512px)

[PWA Builder](https://www.pwabuilder.com/imageGenerator) などで簡単に生成できます。

---

## デモモード

`GAS_URL` が空の場合、デモモードで動作します：
- ログイン: `demo@example.com` または `test@example.com`
- 実際のデータ保存はされません

---

## 勤務時間の計算ロジック

| 区分 | 条件 |
|------|------|
| 通常勤務 | 8時間（休憩1時間を除く） |
| 残業 | 8時間超過分 |
| 深夜残業 | 22:00以降の勤務時間 |
| 休日出勤 | 土曜・日曜の勤務 |

---

## セキュリティについて

- GAS URLは公開URLになるため、メールアドレス認証で社員以外のアクセスを防いでいます
- より高いセキュリティが必要な場合は、GASの実行権限を「ログインしたユーザーのみ」に変更し、Google OAuth認証を追加することを推奨します

# excel2md

ExcelファイルをMarkdown形式に変換するAWSサーバーレスツール。

## アーキテクチャ

```
[ブラウザ]
  ① POST /presign → 署名付き S3 アップロードURL + jobId を取得（瞬時）
  ② PUT xlsx → S3（入力バケット）に直接アップロード（タイムアウトなし）
               ↓ S3 イベント
           Lambda（非同期・何分でも可）
             openpyxl で構造抽出
             Bedrock Claude claude-sonnet-4-5 で並列変換（シートごと）
             .md を S3（出力バケット）に保存
  ③ GET /status?jobId=xxx → 5 秒ごとにポーリング
  ④ done → 署名付きダウンロード URL でブラウザに .md を表示
```

## ディレクトリ構成

```
excel2md/
  lambda/
    lambda_function.py   # Lambda 関数本体
    requirements.txt     # 依存パッケージ
  frontend/
    src/                 # React (Vite + TypeScript + Tailwind)
  README.md
```

## Lambda 環境変数

| 変数名 | 説明 | 例 |
|---|---|---|
| INPUT_BUCKET | アップロード先 S3 バケット名 | excel2md-input-xxx |
| OUTPUT_BUCKET | 変換結果保存先 S3 バケット名 | excel2md-output-xxx |
| BEDROCK_REGION | Bedrock のリージョン | ap-northeast-1 |
| BEDROCK_MODEL_ID | 使用するモデル ID | jp.anthropic.claude-sonnet-4-5-20250929-v1:0 |

## AWS 追加設定（非同期フロー）

### API Gateway に /presign と /status を追加

既存の `/convert` の代わりに 2 つのリソースを作成:

- `POST /presign` → Lambda (プロキシ統合)
- `GET /status` → Lambda (プロキシ統合)

OPTIONS メソッドも両方追加して CORS を有効化する。

### 入力 S3 バケットの CORS 設定

ブラウザから直接 PUT するために CORS が必要。  
S3 → バケット → 「アクセス許可」→「Cross-Origin Resource Sharing (CORS)」に以下を設定:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

本番では `AllowedOrigins` を Amplify のドメインに絞る。

### 出力 S3 バケットの CORS 設定

ブラウザが署名付き URL で GET するために CORS が必要:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

### S3 トリガーの設定

Lambda のトリガーを **入力バケット** の以下に設定（変更不要な場合も確認）:

- イベントタイプ: `PUT`
- プレフィックス: `jobs/`（任意のアップロードで誤起動しないよう設定推奨）

### Lambda の環境変数に INPUT_BUCKET を追加

設定 → 環境変数 → 編集で `INPUT_BUCKET` を入力バケット名で追加する。

### API Gateway に AI 再変換・キャンセル用リソースを追加

AI 再変換を使う場合は、次を **それぞれ別リソース** として追加し、いずれも **Lambda プロキシ統合** と **OPTIONS**（CORS）を付ける。

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/reconvert` | `POST /reconvert` でジョブ開始 |
| `GET` | `/reconvert-status` | クエリ `reconvertId` でステータス取得 |
| `POST` | `/reconvert-cancel` | 本文 `{"reconvertId":"<uuid>"}` でサーバー側ジョブをキャンセル |

- パスは **`/reconvert-cancel` を `/reconvert` とは別リソース**として作成する（`/reconvert` だけだと `...-cancel` が誤ってマッチしない）。
- コードを更新したら **API のデプロイ**（ステージ例: `prod`）を忘れない。

### Lambda のデプロイ（コード更新時）

1. `lambda_function.py` を含むデプロイ用 zip を作成し、**Lambda** → 対象関数 → **コード** からアップロードして **デプロイ**（または **公開**）。
2. 上記 API Gateway に変更があれば **リソースのデプロイ** を実行する。

キャンセル処理は出力バケットへ `jobs/{reconvertId}.reconvert.cancel` を書き込む。Lambda 実行ロールに `OUTPUT_BUCKET` 向けの `s3:PutObject` / `HeadObject` / `DeleteObject` 等が既にあれば追加不要なことが多い。

## フロント（ローカル開発）

```env
# frontend/.env
VITE_API_ENDPOINT=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod
```

開発時は Vite が `/presign` `/status` `/reconvert` `/reconvert-status` `/reconvert-cancel` を API Gateway にプロキシする。

## トラブルシュート

| エラー | 原因 | 対応 |
|---|---|---|
| Failed to fetch | CORS または env 未設定 | `.env` 確認・Vite 再起動 |
| Gateway Timeout | 旧 `/convert` 使用中 | 非同期フロー（presign/status）に移行済みか確認 |
| S3 upload failed | 入力バケットの CORS 未設定 | 上記 CORS 設定を実施 |
| ずっと「変換中」 | Lambda エラー | CloudWatch ログを確認。`INPUT_BUCKET` 環境変数があるか確認 |
| **presign failed (403)** | API Gateway の認可・未デプロイ・パス不一致 | 下記「403 Forbidden を直す」を参照 |

### 403 Forbidden（presign）を直す

ブラウザが `POST .../presign` を呼んだとき **403** になるのは、多くの場合 **API Gateway 側**です（Lambda まで届いていない）。

1. **API Gateway** → 該当 API → **リソース** `/presign` → **POST** を開く。
2. **メソッドリクエスト** → **認可** が **なし（NONE）** になっているか確認する。  
   **AWS_IAM** や **Cognito** などになっていると、ブラウザからそのままでは **403** になります。
3. **統合リクエスト** → Lambda 関数が `excel2md`（正しい関数）に紐づいているか確認する。
4. 右上 **API のデプロイ** → ステージ（例: `prod`）を選んで **デプロイ**する（変更をデプロイしないと反映されません）。
5. `VITE_API_ENDPOINT` が **デプロイしたステージの URL** と一致しているか確認する（例: `.../prod`）。

**Missing Authentication Token** が本文に含まれる場合は、次を確認する。

- **REST API** のとき、`VITE_API_ENDPOINT` は **ステージ名まで**含める（例: `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod`）。`…amazonaws.com` で終わっていると、実在しないパスにリクエストが飛び、このエラーになる。
- API Gateway に **`/presign`（POST）** と **`/status`（GET）** リソースを作成し、**デプロイ**済みか。
- **HTTP API** を使っている場合は URL 形式が異なる。コンソールの **API の詳細**に表示されている **呼び出し URL** をそのまま `VITE_API_ENDPOINT` にコピーする。

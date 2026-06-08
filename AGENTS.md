# AGENTS.md

pi-context-workflow リポジトリで作業するエージェント向けのルール。

## 基本方針

- 基本的に日本語で応答する
- 複数プロジェクトで dogfooding しながら改善する
- reminder で十分なものと deterministic gate で block すべきものを分ける
- LLM の非決定論的判断に任せたくない重要ルールは、extension / CLI / test で決定論的に実装する

## 後方互換性

- 後方互換性は考慮不要
- 既存利用側に合わせて曖昧な default を残さない
- 必須設定があるなら明示的に要求し、未設定時は fail fast する
- 方針変更時は README / scaffold / tests を同じ作業で更新する

## テスト

- 変更後は `npm test` を実行する
- 判定ロジックはできるだけ `src/` の純粋関数に切り出してテストする
- extension は pi API との adapter として薄く保つ

## PR

- PR description はテンプレートに沿って、概要、なぜやるか、影響範囲、動作確認方法、未確認事項と理由を書く
- CLI で PR を作成・編集するときは Markdown を `--body` に直書きせず、`--body-file` を使う
- scaffold は `.github/pull_request_template.md` も作成する

## Scaffold / config

- 新規プロジェクトへ決定論的に導入できる scaffold を維持する
- `.pi/context-workflow.json` は project-specific な設定の入口とする
- source extensions は暗黙 default を持たず、必ず明示させる

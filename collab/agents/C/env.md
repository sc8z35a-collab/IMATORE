# Agent C — dev-env issues

### [C] サンドボックスが無告知で初期化 (clone 直後状態に戻る)
症状: 作業中に突然 `git status` が `On branch main`、`collab/` が存在しない、reflog が `clone` 1 行のみ、autosave デーモン/ログも消滅、swap/:4176 サーバも無い。
原因: 実行環境のリセット (ディスクがリモートから再 clone された)。プロセスとローカル未 push 分は全消失。
解決: `git fetch origin && git checkout -B genspark_ai_developer origin/genspark_ai_developer && bash tools/autosave/start.sh C && bash tools/setup_env.sh`
  (3 分 autosave により失われたのは最大 3 分ぶん。今回は損失ゼロ)
再発防止: 作業開始時/長い処理の後に `git branch --show-current` と `pgrep -f autosave.sh` を確認。/tmp の QA スクリプトはリセットで消えるので tools/ か collab/agents/C/tools/ に置く。

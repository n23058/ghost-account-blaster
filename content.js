// content.js
(function () {
    // 短時間での重複送信を防ぐためのフラグ。一度送信したら1秒間は再送信しないようにする。
    let hasSentMessage = false;

    // バックグラウンドスクリプトにログイン試行を通知する関数
    function sendSubmit() {
        // 既にメッセージを送信済みの場合（フラグがtrueの場合）は何もしない
        if (hasSentMessage) {
            return;
        }
        
        // フラグを立てて、短時間での重複送信をブロックする
        hasSentMessage = true;
        
        // バックグラウンドスクリプトにメッセージを送信する。タイプと現在のホスト名を伝える。
        chrome.runtime.sendMessage({ type: "PASSWORD_SUBMIT", hostname: location.hostname });

        // 1秒後にフラグを解除し、次のログイン操作に備える
        setTimeout(() => {
            hasSentMessage = false;
        }, 1000);
    }

    // 通常のフォーム送信（submitイベント）を監視するリスナー
    window.addEventListener("submit", (e) => {
        try {
            // イベントの対象がHTMLFormElementであることを確認
            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;
            // フォーム内にパスワード入力フィールドがあれば、ログイン試行とみなして関数を呼び出す
            if (form.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        } catch (error) {
            // エラーが発生しても処理を続行する
        }
    }, true); // キャプチャフェーズでイベントを捕捉

    // Enterキーによるフォーム送信を検知するリスナー
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            // 現在アクティブな要素を取得
            const active = document.activeElement;
            // アクティブな要素がフォーム内にあり、そのフォームにパスワードフィールドがあればログイン試行とみなす
            if (active && active.closest("form")?.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        }
    });

    // ボタンクリックによるログインを検知するリスナー（特にSPAサイトで有効）
    document.addEventListener("click", (e) => {
        // クリックされた要素がボタン（buttonまたはinput[type=submit]）であるかを確認
        const btn = e.target.closest("button,input[type=submit]");
        if (btn) {
            // そのボタンがフォーム内にあり、そのフォームにパスワードフィールドがあればログイン試行とみなす
            const form = btn.closest("form");
            if (form && form.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        }
    });
})();
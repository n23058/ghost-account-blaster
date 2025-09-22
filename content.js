
// content.js - 各ウェブページに挿入され、ログイン操作を検知するスクリプト

(function () {
    /**
     * 短時間（1秒）に同じログインイベントが複数回送信されるのを防ぐためのフラグ。
     * フォームの送信、Enterキー、クリックイベントが同時に発火することがあるため。
     */
    let hasSentMessage = false;

    /**
     * background.jsにログインイベントを通知する関数。
     * 重複送信を防ぐためのロックと、1秒後のロック解除を行う。
     */
    function sendSubmit() {
        // フラグが立っている（ロック中）場合は、処理を中断
        if (hasSentMessage) {
            return;
        }
        
        // フラグを立ててロックする
        hasSentMessage = true;
        
        // background.jsへメッセージを送信
        chrome.runtime.sendMessage({ 
            type: "PASSWORD_SUBMIT", // メッセージの種類：パスワード送信
            hostname: location.hostname // 現在のページのホスト名
        });

        // 1秒後にフラグを解除して、次のログイン操作を検知できるようにする
        setTimeout(() => {
            hasSentMessage = false;
        }, 1000);
    }

    /**
     * イベントリスナー1：フォームの "submit" イベント
     * 最も標準的なフォーム送信を捕捉する。
     * useCaptureフラグをtrueに設定し、イベントが他のスクリプトにキャンセルされる前に捕捉する。
     */
    window.addEventListener("submit", (e) => {
        try {
            const form = e.target;
            // パスワード入力欄（<input type="password">）を持つフォームの送信のみを対象とする
            if (form instanceof HTMLFormElement && form.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        } catch(err) {
            // エラーが発生しても拡張機能の動作がウェブサイトに影響を与えないようにする
            console.warn("Ghost Account Blaster (submit listener) Error:", err);
        }
    }, true);

    /**
     * イベントリスナー2："Enter" キーの押下
     * フォーム内でEnterキーを押してログインする操作を捕捉する。
     */
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const activeElement = document.activeElement;
            // 現在フォーカスが当たっている要素が、パスワード入力欄を持つフォーム内にあるかチェック
            if (activeElement && activeElement.closest("form")?.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        }
    });

    /**
     * イベントリスナー3：ボタンの "click" イベント
     * JavaScriptでログイン処理を実装しているモダンなウェブサイト（SPAなど）に対応する。
     * <form>を使わずに<button>のクリックでログインするようなケースを捕捉する。
     */
    document.addEventListener("click", (e) => {
        // クリックされた要素がボタン（<button>または<input type="submit">）かチェック
        const btn = e.target.closest("button, input[type=submit]");
        if (btn) {
            // そのボタンが、パスワード入力欄を持つフォームに属しているかチェック
            const form = btn.closest("form");
            if (form && form.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        }
    });
})();

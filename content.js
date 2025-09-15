// content.js
(function () {
    // ▼▼▼ 修正箇所 ▼▼▼
    // 短時間での重複送信を防ぐためのフラグ
    let hasSentMessage = false;

    function sendSubmit() {
        // 既にメッセージを送信済みの場合は何もしない
        if (hasSentMessage) {
            return;
        }
        
        // フラグを立てて、重複送信をブロック
        hasSentMessage = true;
        
        chrome.runtime.sendMessage({ type: "PASSWORD_SUBMIT", hostname: location.hostname });

        // 1秒後にフラグを解除し、次のログイン操作に備える
        setTimeout(() => {
            hasSentMessage = false;
        }, 1000);
    }
    // ▲▲▲ 修正ここまで ▲▲▲

    // 通常の form submit
    window.addEventListener("submit", (e) => {
        try {
            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;
            if (form.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        } catch { }
    }, true);

    // Enterキー押下検知
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const active = document.activeElement;
            if (active && active.closest("form")?.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        }
    });

    // ログインボタンクリック検知（SPA対応）
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button,input[type=submit]");
        if (btn) {
            const form = btn.closest("form");
            if (form && form.querySelector('input[type="password"]')) {
                sendSubmit();
            }
        }
    });
})();
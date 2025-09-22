// password_popup.js

// HTMLドキュメントの読み込みが完了したときに処理を開始
document.addEventListener('DOMContentLoaded', () => {
    // ローカルストレージから一時的に保存されたパスワードを取得
    chrome.storage.local.get('tempPassword', (data) => {
        const password = data.tempPassword;
        // パスワードが存在する場合
        if (password) {
            // HTML要素に生成されたパスワードを表示
            document.getElementById('generated-password').textContent = password;
            // 使用後、ストレージから一時パスワードを削除する
            chrome.storage.local.remove('tempPassword');
        }
    });

    // 「コピーして閉じる」ボタンの要素を取得
    const copyBtn = document.getElementById('copy-btn');
    // ボタンがクリックされたときの処理を追加
    copyBtn.addEventListener('click', () => {
        // 表示されているパスワードのテキストを取得
        const passwordText = document.getElementById('generated-password').textContent;
        // クリップボードにパスワードをコピー
        navigator.clipboard.writeText(passwordText).then(() => {
            // コピーが成功したらボタンのテキストを変更
            copyBtn.textContent = 'コピー完了！';
            // 1.5秒後にポップアップウィンドウを閉じる
            setTimeout(() => {
                window.close();
            }, 1500);
        });
    });
});
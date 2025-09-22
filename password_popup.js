
// password_popup.js - 生成されたパスワードを表示・コピーするためのポップアップウィンドウのスクリプト

document.addEventListener('DOMContentLoaded', () => {
    // 1. ストレージから一時保存されたパスワードを取得して表示する
    chrome.storage.local.get('tempPassword', (data) => {
        const password = data.tempPassword;
        if (password) {
            // パスワードを表示
            document.getElementById('generated-password').textContent = password;
            // 使用済みの一次パスワードをストレージから削除
            chrome.storage.local.remove('tempPassword');
        } else {
            document.getElementById('generated-password').textContent = 'エラー: パスワードが見つかりません';
        }
    });

    const copyBtn = document.getElementById('copy-btn');

    // 2. 「コピーして閉じる」ボタンのクリックイベント
    copyBtn.addEventListener('click', () => {
        const passwordText = document.getElementById('generated-password').textContent;
        
        // クリップボードにパスワードをコピー
        navigator.clipboard.writeText(passwordText).then(() => {
            // 成功したらボタンのテキストを変更
            copyBtn.textContent = 'コピー完了！';
            copyBtn.disabled = true; // 連続クリックを防止
            
            // 1.5秒後に自動的にウィンドウを閉じる
            setTimeout(() => {
                window.close();
            }, 1500);
        }).catch(err => {
            console.error('パスワードのコピーに失敗しました: ', err);
            copyBtn.textContent = 'コピー失敗';
        });
    });
});

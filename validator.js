// validator.js

(async () => {
    // ページの内容をチェック
    const title = document.title.toLowerCase();
    const bodyText = document.body.innerText.toLowerCase();

    // 失敗を示すキーワード
    const failureKeywords = ['not found', '404', '見つかりません', 'エラー', 'error'];
    
    // 成功を示すキーワード
    const successKeywords = ['アカウント', 'account', '設定', '退会', 'パスワード', 'password'];

    let isSuccess = false;

    // 本文に成功キーワードが一つでもあれば成功とみなす
    for (const keyword of successKeywords) {
        if (bodyText.includes(keyword)) {
            isSuccess = true;
            break;
        }
    }

    // 本文に失敗キーワードが一つでもあれば、成功を覆して失敗とみなす
    for (const keyword of failureKeywords) {
        if (bodyText.includes(keyword) || title.includes(keyword)) {
            isSuccess = false;
            break;
        }
    }

    // 結果をバックグラウンドに送信
    chrome.runtime.sendMessage({ type: 'VALIDATION_RESULT', success: isSuccess });
})();
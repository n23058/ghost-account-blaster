(async () => {
    let isSuccess = false;

    const checkForFailure = () => {
        const title = document.title.toLowerCase();
        const bodyText = document.body.innerText.toLowerCase();
        const failureKeywords = ['not found', '404', '見つかりません', 'エラー', 'error', 'ページが表示できません'];

        for (const keyword of failureKeywords) {
            if (bodyText.includes(keyword) || title.includes(keyword)) {
                return true;
            }
        }

        const scripts = document.querySelectorAll('script');
        const errorPattern = /"(errorCode|error|status)":\s*["']?(404|500|not found|error)["']?|ページが見つかりません|ウェブページは見つかりませんでした/i;

        for (const script of scripts) {
            if (script.innerHTML && errorPattern.test(script.innerHTML)) {
                return true;
            }
        }

        return false;
    };

    const checkForSuccess = () => {
        const title = document.title.toLowerCase();
        const bodyText = document.body.innerText.toLowerCase();
        const successKeywords = ['アカウント', 'account', '設定', '退会', 'パスワード', 'password', 'profile', 'プロフィール', 'ログイン情報'];

        for (const keyword of successKeywords) {
            if (bodyText.includes(keyword) || title.includes(keyword)) {
                return true;
            }
        }
        return false;
    };

    const isFailure = checkForFailure();

    if (!isFailure) {
        isSuccess = checkForSuccess();
    }

    chrome.runtime.sendMessage({ type: 'VALIDATION_RESULT', success: isSuccess });
})();
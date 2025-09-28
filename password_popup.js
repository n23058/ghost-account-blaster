// password_popup.js

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get('tempPassword', (data) => {
        const password = data.tempPassword;
        if (password) {
            document.getElementById('generated-password').textContent = password;
            chrome.storage.local.remove('tempPassword');
        }
    });

    const copyBtn = document.getElementById('copy-btn');
    copyBtn.addEventListener('click', () => {
        const passwordText = document.getElementById('generated-password').textContent;
        navigator.clipboard.writeText(passwordText).then(() => {
            copyBtn.textContent = 'コピー完了！';
            setTimeout(() => {
                window.close();
            }, 1500);
        });
    });
});
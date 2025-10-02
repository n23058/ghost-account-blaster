(function () {
  const originalAlert = window.alert;
  window.alert = function () {
    if (chrome && chrome.runtime) {
      chrome.runtime.sendMessage({ type: "ALERT_TRIGGERED" });
    }
    originalAlert.apply(window, arguments);
  };

  let hasSentMessage = false;

  function sendSubmit() {
    if (hasSentMessage) {
      return;
    }
    hasSentMessage = true;

    if (chrome && chrome.runtime) {
      chrome.runtime.sendMessage({ type: "LOGIN_ATTEMPT" });
    } else {
      console.log("Extension context not available for sending message.");
    }

    setTimeout(() => {
      hasSentMessage = false;
    }, 1000);
  }

  window.addEventListener(
    "submit",
    (e) => {
      try {
        const form = e.target;
        if (
          form instanceof HTMLFormElement &&
          form.querySelector('input[type="password"]')
        ) {
          sendSubmit();
        }
      } catch (error) {}
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const active = document.activeElement;
      if (
        active &&
        active.closest("form")?.querySelector('input[type="password"]')
      ) {
        sendSubmit();
      }
    }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(
      "button,input[type=submit],input[type=button]"
    );
    if (btn) {
      const form = btn.closest("form");
      if (form && form.querySelector('input[type="password"]')) {
        sendSubmit();
      }
    }
  });
})();

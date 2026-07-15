(function () {
  const api = typeof browser !== "undefined" ? browser : chrome;

  api.browserAction.onClicked.addListener(tab => {
    if (!tab || !tab.id) return;

    api.tabs.executeScript(tab.id, { file: "content.js" });
  });
})();

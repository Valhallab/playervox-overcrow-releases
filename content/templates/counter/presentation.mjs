import overcrow from "./overcrow.js";

if (overcrow.runtime.role === "view") {
  const content = document.querySelector("main");
  let observing = false;
  const observer = new ResizeObserver(() => {
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    if (!width || !height) return;
    overcrow.presentation
      .reportSize({
        width: Math.min(4096, width),
        height: Math.min(4096, height),
      })
      .catch(console.error);
  });
  const stop = overcrow.presentation.onSnapshot((snapshot) => {
    if (snapshot.status !== "ready") {
      observer.disconnect();
      observing = false;
      delete document.body.dataset.sizingMode;
      return;
    }
    document.body.dataset.sizingMode = snapshot.data.sizingMode;
    if (!observing) {
      observer.observe(content);
      observing = true;
    }
  });
  window.addEventListener(
    "pagehide",
    () => {
      stop();
      observer.disconnect();
    },
    { once: true },
  );
}

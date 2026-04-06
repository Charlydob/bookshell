export function createResizeAwareRuntimeModule(loadRuntime) {
  let runtimeModule = null;

  async function init() {
    if (runtimeModule) return runtimeModule;
    runtimeModule = await loadRuntime();
    return runtimeModule;
  }

  async function onShow() {
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (_) {}
  }

  function destroy() {}

  return { init, onShow, destroy };
}

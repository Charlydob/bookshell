import { createResizeAwareRuntimeModule } from "../../shared/modules/lifecycle.js";

const lifecycle = createResizeAwareRuntimeModule(() => import("./runtime.js"));

export const init = lifecycle.init;
export const onShow = lifecycle.onShow;
export const destroy = lifecycle.destroy;

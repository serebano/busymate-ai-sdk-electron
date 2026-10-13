// The example's optional bridge callbacks. OFF supplies undefined, so the
// bridge never reports a close as handled when nothing will close.
"use strict";

function actionCallback(enabled, handlers) {
  if (!enabled) return undefined;
  return (name) => {
    if (name === "close") {
      handlers.close();
      return true;
    }
    if (name === "ready") handlers.ready();
    return false;
  };
}

function closeCallback(enabled, perform) {
  return enabled ? perform : undefined;
}

module.exports = { actionCallback, closeCallback };

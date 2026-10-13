// Settings page script. Runs with no Node.js; talks only to window.demo.
"use strict";

const formEl = document.getElementById("settings");
const errorEl = document.getElementById("error");
const logEl = document.getElementById("log");

function fill(form) {
  for (const name of ["assistant", "chatUrl", "locale", "origins", "accountId", "mintUrl"]) formEl.elements[name].value = form[name] ?? "";
  for (const name of ["microphone", "handleCloseAction", "closeCallback"]) formEl.elements[name].checked = form[name] === true;
  formEl.elements.mode.value = form.signedIn ? "identified" : "guest";
}

function read() {
  const el = formEl.elements;
  return {
    assistant: el.assistant.value,
    chatUrl: el.chatUrl.value,
    locale: el.locale.value,
    origins: el.origins.value,
    signedIn: el.mode.value === "identified",
    accountId: el.accountId.value,
    mintUrl: el.mintUrl.value,
    microphone: el.microphone.checked,
    handleCloseAction: el.handleCloseAction.checked,
    closeCallback: el.closeCallback.checked,
  };
}

function append(entry) {
  const item = document.createElement("li");
  item.textContent = `${entry.at} ${entry.kind}${entry.detail ? " — " + entry.detail : ""}`;
  logEl.append(item);
  while (logEl.children.length > 100) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

function show(result) {
  errorEl.textContent = result && result.ok === false ? result.error || "Refused." : "";
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await window.demo.apply(read(), formEl.elements.sessionToken.value);
  show(result);
  if (result.ok) fill(result.form);
});
document.getElementById("accountChanged").addEventListener("click", async () => show(await window.demo.accountChanged(read())));
document.getElementById("closeChat").addEventListener("click", () => window.demo.closeChat());
document.getElementById("reset").addEventListener("click", async () => {
  fill(await window.demo.reset());
  formEl.elements.sessionToken.value = "";
  show(null);
});

window.demo.onLog(append);
window.demo.state().then((state) => {
  fill(state.form);
  const v = state.versions;
  document.getElementById("versions").textContent =
    `SDK ${v.sdk} · identity bridge ${v.bridge} · microphone adapter ${v.microphone} · Electron ${v.electron} (${v.platform})`;
  state.log.forEach(append);
});

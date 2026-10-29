import { STORAGE_KEY, normalizeDashboardUrl, savedUrl } from "./launcher";

const input = document.getElementById("url") as HTMLInputElement;
const err = document.getElementById("err") as HTMLParagraphElement;
const params = new URLSearchParams(location.search);
const saved = savedUrl(localStorage);
if (saved) input.value = saved;
// ?change keeps the launcher open so the URL can be edited.
if (saved && !params.has("change")) location.replace(saved);

document.getElementById("f")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const r = normalizeDashboardUrl(input.value);
  if ("error" in r) { err.textContent = r.error; return; }
  localStorage.setItem(STORAGE_KEY, r.url);
  location.replace(r.url);
});

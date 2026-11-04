/** Keep visible view text and its accessible label consistent after live updates. */
export function paintPostViews(control: HTMLElement | null, views: number) {
  if (!control) return;
  const number = views.toLocaleString("en-US");
  const unit = views === 1 ? "view" : "views";
  control.setAttribute("aria-label", `${number} ${unit}`);
  const count = control.querySelector("[data-view-count]");
  const suffix = control.querySelector("[data-view-unit]");
  if (count) count.textContent = number;
  if (suffix) suffix.textContent = unit;
}

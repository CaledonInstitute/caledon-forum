export const memberLabel = "Official Member of Caledon Institute.";
export const memberSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="m12 1 3 2 3.6.4.8 3.5L22 10l-1 3.5.1 3.6-3.3 1.6-2.4 2.7-3.4-1-3.4 1-2.4-2.7-3.3-1.6.1-3.6L2 10l2.6-3.1.8-3.5L9 3Z" />
    <path d="m7.5 11.8 3 3 6-6" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
export function memberBadgeMarkup() {
  const id = `member-${crypto.randomUUID()}`;
  return `<span class="badge" data-member-badge role="button" tabindex="0" aria-label="${memberLabel}" aria-describedby="${id}" aria-expanded="false">${memberSvg}<span class="badge-tooltip" id="${id}" role="tooltip">${memberLabel}</span></span>`;
}

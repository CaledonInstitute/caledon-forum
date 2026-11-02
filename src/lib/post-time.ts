const zone = "Asia/Jakarta";
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone });
const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone });
export const dayLabel = (value: number) => date.format(value);
export const dayKey = (value: number) => day.format(value);
export const clockTime = (value: number) => clock.format(value);
export const postTime = (value: number) => `${dayLabel(value)} ${clockTime(value)}`;

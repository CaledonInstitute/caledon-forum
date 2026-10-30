const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "Asia/Jakarta" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" });
export const postTime = (value: number) => `${date.format(value)} ${clock.format(value)}`;

export const RESERVED_USERNAMES = new Set([
  'login','register','verify','forgot-password','reset-password','onboarding',
  'settings','notifications','admin','rules','privacy','search','api','p','u',
  'thread','edit','_astro','_image','_server-islands','_actions','robots','sitemap',
  'favicon','social','assets','sitemaps','constructor','prototype','__proto__',
]);
export const isReservedUsername = (value:string) => RESERVED_USERNAMES.has(value.toLowerCase());
export const isValidUsername = (value:string) => /^[a-zA-Z_][a-zA-Z0-9_]{0,29}$/.test(value) && !isReservedUsername(value);

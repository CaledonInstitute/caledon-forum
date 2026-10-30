import { hashPassword } from "better-auth/crypto";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = Date.now();
const statements = [
  `INSERT OR IGNORE INTO user(id,name,email,email_verified,username,created_at,updated_at,bio) VALUES('qa-alice','Caledon QA','qa-alice@caledon.invalid',1,'qa_caledon',${now},${now},'Local regression-test profile. Not published to production.')`,
  `INSERT OR IGNORE INTO user(id,name,email,email_verified,username,created_at,updated_at) VALUES('qa-bob','Research QA','qa-bob@caledon.invalid',1,'qa_research',${now},${now})`,
];
// Dedicated encrypted-DM browser fixtures; credentials never leave the local D1 database.
for (const [id, username] of [
  ["qa-dm-sender", "qa_dm_sender"],
  ["qa-dm-recipient", "qa_dm_recipient"],
]) {
  statements.push(
    `INSERT OR IGNORE INTO user(id,name,email,email_verified,username,created_at,updated_at) VALUES(${q(id)},${q(username)},${q(username + "@caledon.invalid")},1,${q(username)},${now},${now})`
  );
  statements.push(
    `INSERT OR IGNORE INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(${q(id + "-password")},${q(id)},'credential',${q(id)},${q(await hashPassword("Local-DM-browser-password-123"))},${now},${now})`
  );
}
statements.push("UPDATE user SET image='https://avatars.githubusercontent.com/u/9919?v=4' WHERE id IN ('qa-dm-sender','qa-dm-recipient')");
// Dedicated profile-card fixtures; these do not change the signed-in QA accounts.
for (const [username, name, bio, image, cover] of [
  [
    "qa_og_cover",
    "Caledon Research",
    "Exploring vulnerability research and the things we learn by building together.",
    "https://avatars.githubusercontent.com/u/9919?v=4",
    "https://avatars.githubusercontent.com/u/9919?v=4",
  ],
  ["qa_og_empty", "New researcher", "", null, null],
  [
    "qa_og_long",
    "A very long researcher name with emoji 😀 and more words than the card can display",
    "Research 😀 🧪 " + "Questions, experiments, and useful observations. ".repeat(6),
    null,
    null,
  ],
  [
    "qa_og_broken",
    "Unavailable images",
    "The profile remains readable when external images cannot be loaded.",
    "https://example.com/missing-avatar.png",
    "https://example.com/missing-cover.png",
  ],
]) {
  statements.push(
    `INSERT INTO user(id,name,email,email_verified,username,created_at,updated_at,bio,image,cover_image) VALUES(${q(username)},${q(name)},${q(username + "@caledon.invalid")},1,${q(username)},${now},${now},${q(bio)},${image ? q(image) : "NULL"},${cover ? q(cover) : "NULL"}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,bio=excluded.bio,image=excluded.image,cover_image=excluded.cover_image`
  );
}
statements.push(
  `INSERT OR IGNORE INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('qa-og-github','qa-og-github','github','qa_og_long',${now},${now})`,
  `INSERT INTO memberships(user_id,github_id,state,checked_at) VALUES('qa_og_long','qa-og-github','active',${now}) ON CONFLICT(user_id) DO UPDATE SET checked_at=excluded.checked_at,state=excluded.state`
);
const roots = [
  [
    "qa-notebook",
    'What does a good research notebook look like?\n\nI’ve been trying to capture the questions behind an experiment, not just its results. What do you write down when an assumption turns out to be wrong?\n\n```python\nquestion = "What would change my mind?"\nnotebook.add(question)\n```',
  ],
  ["qa-experiment", "Small experiments, useful questions.\n\nA thread for the things we learn by building. Share a result, an unexpected behavior, or a question worth keeping."],
  ["qa-long", "Long-form discussion fixture.\n\n" + "A useful observation deserves enough room to explain its context. ".repeat(100)],
];
for (let i = 0; i < roots.length; i++)
  statements.push(
    `INSERT OR IGNORE INTO posts(id,author_id,body,created_at,updated_at) VALUES(${q(roots[i][0])},'qa-alice',${q(roots[i][1])},${now - i * 3600000},${now - i * 3600000})`
  );
for (let i = 0; i < 23; i++)
  statements.push(
    `INSERT OR IGNORE INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('qa-reply-${String(i).padStart(2, "0")}','qa-bob','qa-notebook','qa-notebook',${q(i === 0 ? "Keeping a record of failed assumptions has been useful.\n\n" + "This is a long reply for accessibility and pagination testing. ".repeat(30) : `Reply ${i + 1}: a local pagination fixture.`)},${now + i},${now + i})`
  );
for (const [id, parent, body, deleted, offset] of [
  ["qa-branch-a", "qa-reply-00", "A separate branch of the notebook conversation.", 0, 100],
  ["qa-branch-b", "qa-reply-00", "A sibling branch, not an ancestor.", 0, 101],
  ["qa-branch-deleted", "qa-branch-a", "", 1, 102],
  ["qa-branch-leaf", "qa-branch-deleted", "A reply whose parent was deleted.", 0, 103],
])
  statements.push(
    `INSERT OR IGNORE INTO posts(id,author_id,root_id,parent_id,body,deleted,created_at,updated_at) VALUES(${q(id)},'qa-alice','qa-notebook',${q(parent)},${q(body)},${deleted},${now + offset},${now + offset})`
  );
// A local-only signed session lets Playwright exercise the hydrated composer.
const vars = await readFile(".dev.vars", "utf8").catch(() => "");
const variable = (name) =>
  vars
    .match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, "");
if (variable("AUTH_ENABLED") === "true" && variable("BETTER_AUTH_SECRET")) {
  for (const [userId, sessionId, filename] of [
    ["qa-alice", "qa-browser-session", "qa-session.json"],
    ["qa-bob", "qa-mention-session", "qa-mention-session.json"],
    ["qa-dm-sender", "qa-dm-sender-session", "qa-dm-sender-session.json"],
    ["qa-dm-recipient", "qa-dm-recipient-session", "qa-dm-recipient-session.json"],
  ]) {
    const token = randomUUID();
    statements.push(
      `INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(${q(sessionId)},${q(token)},${q(userId)},${now + 86400000},${now},${now})`
    );
    const signature = createHmac("sha256", variable("BETTER_AUTH_SECRET")).update(token).digest("base64");
    await mkdir(".astro", { recursive: true });
    await writeFile(`.astro/${filename}`, JSON.stringify({ name: "better-auth.session_token", value: encodeURIComponent(`${token}.${signature}`), url: "http://localhost:4321" }));
  }
}
statements.push(
  `INSERT OR IGNORE INTO posts(id,author_id,body,created_at,updated_at) VALUES('qa-media','qa-alice','External media regression fixture.\n\nhttps://avatars.githubusercontent.com/u/9919?v=4\n\nhttps://youtu.be/jNQXAC9IVRw',${now - 18000000},${now - 18000000})`
);
statements.push(
  `INSERT OR IGNORE INTO link_previews(id,url,kind,image,checked_at) VALUES('qa-image','https://avatars.githubusercontent.com/u/9919?v=4','image','https://avatars.githubusercontent.com/u/9919?v=4',${now})`
);
statements.push(
  `INSERT OR IGNORE INTO link_previews(id,url,kind,title,site,image,video_id,checked_at) VALUES('qa-video','https://youtu.be/jNQXAC9IVRw','youtube','YouTube preview test fixture','YouTube','https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg','jNQXAC9IVRw',${now})`
);
statements.push(
  `INSERT OR IGNORE INTO post_links(post_id,preview_id,position) VALUES('qa-media','qa-image',0)`,
  `INSERT OR IGNORE INTO post_links(post_id,preview_id,position) VALUES('qa-media','qa-video',1)`
);
await mkdir(".astro", { recursive: true });
await writeFile(".astro/seed-local.sql", statements.join(";\n") + ";\n");
const child = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "caledon-forum-db", "--local", "--file", ".astro/seed-local.sql"], {
  stdio: "inherit",
  windowsHide: true,
});
process.exitCode = child.status || 0;

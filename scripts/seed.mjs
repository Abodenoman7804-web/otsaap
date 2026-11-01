/**
 * Idempotent demo seed. Run with: node scripts/seed.mjs
 * Creates three demo accounts, one direct conversation, one group and a status.
 */
import { readFileSync } from "node:fs";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCb);

const envFile = readFileSync(new URL("../.env", import.meta.url), "utf8");
const env = Object.fromEntries(
  envFile
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const connectionString =
  process.env.DATABASE_URL ?? env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

const client = new pg.Client({ connectionString });
await client.connect();

const passwordHash = await hashPassword("Demo12345");

const demoUsers = [
  {
    publicId: "RISALA01",
    email: "demo1@example.com",
    displayName: "سارة أحمد",
    about: "مهندسة برمجيات · أحب القهوة والكتب",
  },
  {
    publicId: "RISALA02",
    email: "demo2@example.com",
    displayName: "Omar Khaled",
    about: "Product designer · Based in Cairo",
  },
  {
    publicId: "RISALA03",
    email: "demo3@example.com",
    displayName: "ليلى منصور",
    about: "صحافية · مهتمة بالتقنية",
  },
];

const ids = {};
for (const user of demoUsers) {
  const existing = await client.query("select id from users where email = $1", [user.email]);
  if (existing.rows.length > 0) {
    ids[user.publicId] = existing.rows[0].id;
    continue;
  }
  const inserted = await client.query(
    `insert into users (public_id, email, password_hash, display_name, about, locale, theme)
     values ($1, $2, $3, $4, $5, 'ar', 'light') returning id`,
    [user.publicId, user.email, passwordHash, user.displayName, user.about],
  );
  ids[user.publicId] = inserted.rows[0].id;
}

const a = ids.RISALA01;
const b = ids.RISALA02;
const c = ids.RISALA03;

// Direct conversation (idempotent via direct_key)
const directKey = a < b ? `${a}:${b}` : `${b}:${a}`;
let direct = await client.query("select id from conversations where direct_key = $1", [directKey]);
if (direct.rows.length === 0) {
  direct = await client.query(
    `insert into conversations (type, direct_key, created_by, last_message_at)
     values ('direct', $1, $2, now()) returning id`,
    [directKey, a],
  );
  const conversationId = direct.rows[0].id;
  await client.query(
    `insert into conversation_members (conversation_id, user_id, role) values ($1,$2,'member'),($1,$3,'member')`,
    [conversationId, a, b],
  );
  const seedMessages = [
    [a, "مرحباً عمر! وصلتني رسالتك، سعيد بالتواصل 👋"],
    [b, "أهلاً سارة! كيف حالك؟ هل جرّبت المعرّف الرقمي الجديد؟"],
    [a, "نعم، بحثت عنك مباشرة باستخدام RISALA02 وبدأت المحادثة فوراً"],
    [b, "رائع! سأرسل لك ملف التصميم الآن 📎"],
  ];
  for (const [senderId, body] of seedMessages) {
    await client.query(
      `insert into messages (conversation_id, sender_id, kind, body, created_at)
       values ($1,$2,'text',$3, now())`,
      [conversationId, senderId, body],
    );
  }
  await client.query(
    `insert into message_receipts (message_id, user_id, read_at)
     select m.id, $2, now() from messages m where m.conversation_id = $1 and m.sender_id = $3`,
    [conversationId, b, a],
  );
}

// Group conversation
let group = await client.query("select id from conversations where type = 'group' and name = $1", [
  "فريق المنتج",
]);
if (group.rows.length === 0) {
  group = await client.query(
    `insert into conversations (type, name, description, created_by, last_message_at)
     values ('group', $1, $2, $3, now()) returning id`,
    ["فريق المنتج", "تنسيق العمل بين التصميم والبرمجة", a],
  );
  const groupId = group.rows[0].id;
  await client.query(
    `insert into conversation_members (conversation_id, user_id, role) values
       ($1,$2,'admin'),($1,$3,'member'),($1,$4,'member')`,
    [groupId, a, b, c],
  );
  await client.query(
    `insert into messages (conversation_id, sender_id, kind, body) values ($1,$2,'text',$3)`,
    [groupId, c, "مرحباً بالجميع، سأشارك خطة الأسبوع القادم"],
  );
}

// Status
const statusCount = await client.query("select count(*)::int as count from statuses where user_id = $1", [a]);
if (statusCount.rows[0].count === 0) {
  await client.query(
    `insert into statuses (user_id, kind, body, background, audience, expires_at)
     values ($1,'text',$2,'grad-1','everyone', now() + interval '24 hours')`,
    [a, "يوم سعيد! ✨"],
  );
}

const summary = await client.query(
  "select public_id, email, display_name from users order by id",
);
console.log("Seed complete. Users:");
for (const row of summary.rows) console.log(` - ${row.public_id} | ${row.email} | ${row.display_name}`);
await client.end();

// 初始化：POST /api/admin/init?token=xxx
// 用与业务完全相同的 D1 连接建表，规避命令行与服务各连一份本地库的问题。
// DEV_MODE=1 时免口令，便于本地演示；正式环境必须设置 INIT_TOKEN 再调用。
import { type Env, PLAN_RULES, fail, hashPassword, json, makeLicenseKey, now } from "../../_shared";
import { SCHEMA_SQL } from "../../_schema";

function splitSql(src: string) {
  return src
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

export const onRequestPost = async (ctx: { request: Request; env: Env; params: Record<string, string> }) => {
  const { request: req, env } = ctx;
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-init-token") || "";
  const allowDev = env.DEV_MODE === "1";

  if (!allowDev) {
    if (!env.INIT_TOKEN) return fail("未设置 INIT_TOKEN，且当前非演示模式，初始化已关闭", 403);
    if (token !== env.INIT_TOKEN) return fail("口令不正确", 401);
  }

  const stmts = splitSql(SCHEMA_SQL);
  try {
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
  } catch (e: any) {
    return fail("建表失败: " + (e?.message || e), 500);
  }

  // 迁移：为已存在的 users 表补 avatar 列（列已存在时跳过，幂等）
  try {
    await env.DB.prepare("select avatar from users limit 1").first();
  } catch {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN avatar TEXT").run();
  }

  // 灌入一条演示账号：demo_user / Demo123456，便于打开页面直接体验
  const seeded = await seedDemo(env);

  const t = await env.DB.prepare("select count(*) c from users").first<{ c: number }>();
  return json({
    ok: true,
    tables: stmts.length,
    users: t?.c ?? 0,
    demo: seeded,
    at: now(),
    mode: allowDev ? "DEV_MODE" : "TOKEN",
  });
};

async function seedDemo(env: Env) {
  const exist = await env.DB.prepare("select id,account from users where account=?").bind("demo_user").first<any>();
  if (exist) return { account: exist.account, note: "演示账号已存在" };

  const { hash, salt } = await hashPassword("Demo123456");
  const ts = now();
  const userId = crypto.randomUUID();

  await env.DB
    .prepare(
      `insert into users (id,account,display_name,email,phone,pwd_hash,pwd_salt,plan,status,failed_login,created_at,activated_at)
       values (?,?,?,?,?,?,?, 'basic','active',0,?,?)`,
    )
    .bind(userId, "demo_user", "演示账号", "demo@example.com", null, hash, salt, ts, ts)
    .run();
  await env.DB
    .prepare(
      `insert into licenses (id,user_id,license_key,plan,status,seats,issued_at,expires_at,renew_source)
       values (?,?,?, 'basic','active',?,?,null,'demo')`,
    )
    .bind(crypto.randomUUID(), userId, makeLicenseKey("basic"), PLAN_RULES.basic.seats, ts)
    .run();
  return { account: "demo_user", password: "Demo123456", email: "demo@example.com" };
}

export const onRequest = () => fail("方法不允许", 405);

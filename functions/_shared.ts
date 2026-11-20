// 共享工具：密码派生、令牌、验证码、鉴权、响应
// 运行环境：Cloudflare Pages Functions（Web Crypto 原生可用，零第三方依赖）

export interface Env {
  DB: D1Database;
  DEV_MODE?: string;              // "1" = 允许在未配置通道时把验证码回显给调用方（仅本地测试）
  INIT_TOKEN?: string;            // 初始化接口口令（正式环境必设）
  CREEM_WEBHOOK_SECRET?: string;  // 回调验签密钥
  CREEM_API_KEY?: string;
  CREEM_PRODUCT_PRO?: string;     // 专业版商品 ID
  CREEM_PRODUCT_BASIC?: string;
  CREEM_CHECKOUT_PRO?: string;    // 专业版托管结账链接

  // ---- 邮件通道（任选其一即可真实发信）----
  MAIL_FROM?: string;             // 发件地址，如 no-reply@yourdomain.com
  MAIL_FROM_NAME?: string;        // 发件人显示名
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  SENDGRID_API_KEY?: string;
  MAIL_WEBHOOK_URL?: string;      // 自建/企业邮件 HTTP 服务
  MAIL_WEBHOOK_TOKEN?: string;

  // ---- 短信通道 ----
  SMS_PROVIDER?: string;          // 目前支持 "webhook"
  SMS_WEBHOOK_URL?: string;
  SMS_WEBHOOK_TOKEN?: string;
}

export const PLAN_RULES: Record<string, { seats: number; features: string[]; label: string }> = {
  basic: { seats: 1, features: ["core_editor", "export_png"], label: "普通版" },
  pro: { seats: 3, features: ["core_editor", "export_png", "batch_render", "api_access", "priority_support"], label: "专业版" },
};

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

// ---------- 响应 ----------
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
export const ok = (d: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ ok: true, ...d }, 200, headers);
export const fail = (msg: string, status = 400, extra: Record<string, unknown> = {}) =>
  json({ ok: false, error: msg, ...extra }, status);

// ---------- 密码：PBKDF2-SHA256 / 150000 轮 ----------
export async function hashPassword(pwd: string, saltHex?: string) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pwd), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" },
    key,
    256,
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(pwd: string, saltHex: string, expectedHex: string) {
  const { hash } = await hashPassword(pwd, saltHex);
  return timingSafeEqualHex(hash, expectedHex);
}

// ---------- 验证码 ----------
export function genCode6() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function issueOtp(env: Env, target: string, scene: string) {
  // 频控：同一目标同一场景 10 分钟内最多 5 条（注册/登录互不挤占额度）
  const since = now() - 10 * 60 * 1000;
  const row = await env.DB
    .prepare("select count(*) c from otp where target=? and scene=? and created_at>?")
    .bind(target, scene, since)
    .first<{ c: number }>();
  if ((row?.c ?? 0) >= 5) return { code: "", ttl: 0, error: "发送过于频繁，请 10 分钟后再试" };

  const code = genCode6();
  await env.DB
    .prepare("insert into otp (id,target,scene,code,expires_at,attempts,consumed,created_at) values (?,?,?,?,?,0,0,?)")
    .bind(uid(), target, scene, code, now() + 5 * 60 * 1000, now())
    .run();
  return { code, ttl: 5, error: "" };
}

export async function consumeOtp(env: Env, target: string, scene: string, code: string) {
  const rec = await env.DB
    .prepare("select * from otp where target=? and scene=? and consumed=0 order by created_at desc limit 1")
    .bind(target, scene)
    .first<any>();
  if (!rec) return { pass: false, msg: "请先获取验证码" };
  if (rec.expires_at < now()) return { pass: false, msg: "验证码已过期，请重新获取" };
  if (rec.attempts >= 5) {
    await env.DB.prepare("update otp set consumed=1 where id=?").bind(rec.id).run();
    return { pass: false, msg: "错误次数过多，验证码已作废" };
  }
  if (rec.code !== code) {
    await env.DB.prepare("update otp set attempts=attempts+1 where id=?").bind(rec.id).run();
    return { pass: false, msg: "验证码不正确" };
  }
  await env.DB.prepare("update otp set consumed=1 where id=?").bind(rec.id).run();
  return { pass: true, msg: "" };
}

// 作废指定目标当前未消费的验证码（发送失败回滚用）
export async function voidOtp(env: Env, target: string, scene: string) {
  await env.DB
    .prepare("update otp set consumed=1 where target=? and scene=? and consumed=0")
    .bind(target, scene)
    .run();
}

// ---------- 会话（库内只存 token 的 SHA-256） ----------
export async function createSession(env: Env, userId: string) {
  const raw = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(raw);
  const ttlMs = 7 * 24 * 3600 * 1000;
  await env.DB
    .prepare("insert into sessions (token_hash,user_id,expires_at,created_at) values (?,?,?,?)")
    .bind(tokenHash, userId, now() + ttlMs, now())
    .run();
  const secure = " __Host-sid";
  void secure;
  return {
    raw,
    cookie: `sid=${raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttlMs / 1000}`,
  };
}

export function cookieToken(req: Request) {
  const h = req.headers.get("cookie") || "";
  const m = h.split(/;\s*/).find((p) => p.startsWith("sid="));
  return m ? m.slice(4) : "";
}

export async function authUser(req: Request, env: Env) {
  const t = cookieToken(req);
  if (!t) return null;
  const s = await env.DB.prepare("select * from sessions where token_hash=?").bind(await sha256Hex(t)).first<any>();
  if (!s || s.expires_at < now()) return null;
  const u = await env.DB.prepare("select * from users where id=?").bind(s.user_id).first<any>();
  return u && u.status === "active" ? u : null;
}

export async function destroySession(req: Request, env: Env) {
  const t = cookieToken(req);
  if (t) await env.DB.prepare("delete from sessions where token_hash=?").bind(await sha256Hex(t)).run();
}

export const clearCookie = "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";

// ---------- 业务读取 ----------
export async function getLicense(env: Env, userId: string) {
  return env.DB.prepare("select * from licenses where user_id=?").bind(userId).first<any>();
}

export async function listDevices(env: Env, licenseId: string) {
  const r = await env.DB
    .prepare(
      "select device_id, device_name, activated_at, last_seen_at from activations where license_id=? order by activated_at",
    )
    .bind(licenseId)
    .all();
  return r.results || [];
}

export async function audit(env: Env, userId: string | null, action: string, detail: string) {
  await env.DB
    .prepare("insert into audit_log (id,user_id,action,detail,created_at) values (?,?,?,?,?)")
    .bind(uid(), userId, action, detail, now())
    .run();
}

export function makeLicenseKey(plan: string) {
  const seg = () => bytesToHex(crypto.getRandomValues(new Uint8Array(2))).toUpperCase();
  return `${plan === "pro" ? "PRO" : "BAS"}-${seg()}-${seg()}-${seg()}-${seg()}`;
}

// 授权对外结构：屏蔽数据库字段，只暴露客户端需要的信息
export function publicLicense(lic: any) {
  if (!lic) return null;
  const plan = PLAN_RULES[lic.plan] ? lic.plan : "basic";
  const rule = PLAN_RULES[plan];
  const expired = !!lic.expires_at && lic.expires_at < now();
  return {
    license_key: lic.license_key,
    plan,
    plan_label: rule.label,
    status: expired ? "expired" : lic.status,
    seats: lic.seats ?? rule.seats,
    features: rule.features,
    issued_at: lic.issued_at,
    expires_at: lic.expires_at ?? null,
    expired,
  };
}

export function pubUser(u: any) {
  return {
    id: u.id,
    account: u.account,
    email: u.email ?? null,
    phone: u.phone ?? null,
    avatar: u.avatar ?? null,
    plan: u.plan,
    status: u.status,
    created_at: u.created_at,
  };
}

export const isDev = (env: Env) => env.DEV_MODE === "1";

// ---------- 输入校验 ----------
export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
export const validPhone = (s: string) => /^\+?\d{7,15}$/.test(s);
export const validAccount = (s: string) => /^[a-zA-Z0-9_]{3,32}$/.test(s);

export function passwordProblem(s: string) {
  if (!s || s.length < 8) return "密码至少 8 位";
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return "密码需同时包含字母和数字";
  return "";
}

// ---------- 编码 ----------
export const bytesToHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export function hexToBytes(h: string) {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return a;
}
export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToHex(new Uint8Array(d));
}
function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function hmacSha256Hex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return bytesToHex(new Uint8Array(sig));
}

export async function readBody(req: Request): Promise<Record<string, any>> {
  try {
    return (await req.json()) as Record<string, any>;
  } catch {
    return {};
  }
}

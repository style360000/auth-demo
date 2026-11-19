// POST /api/login { identifier, password?, code? }
// identifier 可为账号 / 邮箱 / 手机号。两种登录方式：密码 或 验证码。
import {
  type Env,
  audit,
  createSession,
  consumeOtp,
  fail,
  getLicense,
  ok,
  pubUser,
  publicLicense,
  readBody,
  verifyPassword,
} from "../_shared";

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const b = await readBody(req);
  const idn = String(b.identifier || "").trim().toLowerCase();
  const password = String(b.password || "");
  const code = String(b.code || "").trim();
  if (!idn) return fail("请填写账号 / 邮箱 / 手机号");
  if (!password && !code) return fail("请使用密码或验证码登录");

  const u = await env.DB
    .prepare("select * from users where lower(account)=? or lower(email)=? or phone=?")
    .bind(idn, idn, idn)
    .first<any>();
  if (!u) return fail("账号不存在，请先注册", 404);
  if (u.status === "disabled") return fail("该账号已被停用", 403);

  if (code) {
    if (idn !== String(u.email || "").toLowerCase() && idn !== String(u.phone || ""))
      return fail("验证码只能发到邮箱或手机号，请改用邮箱/手机号登录");
    const chk = await consumeOtp(env, idn, "login", code);
    if (!chk.pass) return fail(chk.msg);
  } else {
    const good = await verifyPassword(password, u.pwd_salt, u.pwd_hash);
    if (!good) {
      await env.DB.prepare("update users set failed_login=failed_login+1 where id=?").bind(u.id).run();
      const n = (u.failed_login || 0) + 1;
      if (n >= 5) return fail("密码错误次数过多，请改用验证码登录", 429);
      return fail(`密码不正确（剩余尝试 ${5 - n} 次）`, 401);
    }
    await env.DB.prepare("update users set failed_login=0 where id=?").bind(u.id).run();
  }

  const s = await createSession(env, u.id);
  const lic = await getLicense(env, u.id);
  await audit(env, u.id, "login", code ? "验证码登录成功" : "密码登录成功");
  return ok({ user: pubUser(u), license: publicLicense(lic) }, { "set-cookie": s.cookie });
};

export const onRequest = () => fail("方法不允许", 405);

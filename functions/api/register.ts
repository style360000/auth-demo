// POST /api/register { account, password, email?, phone?, code }
import {
  type Env,
  PLAN_RULES,
  audit,
  consumeOtp,
  createSession,
  fail,
  getLicense,
  hashPassword,
  makeLicenseKey,
  now,
  ok,
  passwordProblem,
  readBody,
  uid,
  validAccount,
  validEmail,
  validPhone,
  publicLicense,
} from "../_shared";

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const b = await readBody(req);

  const account = String(b.account || "").trim();
  const password = String(b.password || "");
  const email = String(b.email || "").trim().toLowerCase();
  const phone = String(b.phone || "").trim();
  const code = String(b.code || "").trim();

  // 1) 字段校验
  if (!validAccount(account)) return fail("账号需 3–32 位，仅限字母、数字、下划线");
  const pp = passwordProblem(password);
  if (pp) return fail(pp);
  if (!email && !phone) return fail("注册需提供邮箱或手机号");
  if (email && !validEmail(email)) return fail("邮箱格式不正确");
  if (phone && !validPhone(phone)) return fail("手机号格式不正确");

  // 2) 唯一性（分别检查，命中即返回具体原因）
  if (await env.DB.prepare("select id from users where account=?").bind(account).first())
    return fail("该账号已被占用", 409);
  if (email && (await env.DB.prepare("select id from users where email=?").bind(email).first()))
    return fail("该邮箱已注册，请直接登录", 409);
  if (phone && (await env.DB.prepare("select id from users where phone=?").bind(phone).first()))
    return fail("该手机号已注册，请直接登录", 409);

  // 3) 消费验证码
  const target = email || phone;
  const chk = await consumeOtp(env, target, "register", code);
  if (!chk.pass) return fail(chk.msg);

  // 4) 建用户 + 发放普通版授权
  const { hash, salt } = await hashPassword(password);
  const userId = uid();
  const ts = now();

  await env.DB
    .prepare(
      `insert into users (id,account,display_name,email,phone,pwd_hash,pwd_salt,plan,status,failed_login,created_at,activated_at)
       values (?,?,?,?,?,?,?, 'basic','active',0,?,?)`,
    )
    .bind(userId, account, account, email || null, phone || null, hash, salt, ts, ts)
    .run();

  await env.DB
    .prepare(
      `insert into licenses (id,user_id,license_key,plan,status,seats,issued_at,expires_at,renew_source)
       values (?,?,?, 'basic','active',?,?, null,'demo')`,
    )
    .bind(uid(), userId, makeLicenseKey("basic"), PLAN_RULES.basic.seats, ts)
    .run();

  await audit(env, userId, "register", `账号 ${account} 注册成功，已发放普通版授权`);

  const s = await createSession(env, userId);
  const lic = await getLicense(env, userId);
  return ok(
    {
      user: { id: userId, account, email: email || null, phone: phone || null, plan: "basic" },
      license: publicLicense(lic),
    },
    { "set-cookie": s.cookie },
  );
};

export const onRequest = () => fail("方法不允许", 405);

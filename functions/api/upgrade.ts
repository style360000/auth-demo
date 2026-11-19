// 升级专业版
// GET  /api/upgrade → 返回托管结账链接（真实付费入口）
// POST /api/upgrade { mock: true } → 仅 DEV_MODE 下模拟"已付费"，用于本地演示自动开通
import {
  type Env,
  PLAN_RULES,
  audit,
  authUser,
  fail,
  getLicense,
  isDev,
  makeLicenseKey,
  now,
  ok,
  publicLicense,
  readBody,
} from "../_shared";

export const onRequestGet = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);

  const lic = await getLicense(env, u.id);
  if (lic?.plan === "pro") return ok({ already_pro: true, license: publicLicense(lic) });

  const base = "https://checkout.creem.io";
  const pid = env.CREEM_PRODUCT_PRO || "";
  const checkoutUrl = pid
    ? `${base}/product/${pid}?customer_ref=${encodeURIComponent(u.id)}`
    : (env.CREEM_CHECKOUT_PRO || "");

  return ok({
    plan: "pro",
    price_hint: "$19 / 月（示例定价，以 Creem 后台为准）",
    checkout_url: checkoutUrl,
    configured: !!checkoutUrl,
    mock_available: isDev(env),
    note: checkoutUrl
      ? "用户点击后前往 Creem 托管收银台付款；付款成功后 Creem 会回调 /api/webhook/creem 自动开通。"
      : "尚未配置 CREEM_PRODUCT_PRO。本地演示可用 POST /api/upgrade {mock:true} 模拟开通。",
  });
};

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);
  const b = await readBody(req);

  if (!isDev(env) || !b.mock)
    return fail("此接口为演示通道。正式环境请通过 GET /api/upgrade 的托管收银台付款，由回调自动开通。", 403);

  await grantPro(env, u.id, "demo");
  const lic = await getLicense(env, u.id);
  await audit(env, u.id, "upgrade.mock", "演示模式模拟开通专业版");
  return ok({ upgraded: true, license: publicLicense(lic) });
};

// 供回调复用：把授权升级到专业版
export async function grantPro(env: Env, userId: string, source: string) {
  const ts = now();
  const lic = await getLicense(env, userId);
  if (lic) {
    await env.DB
      .prepare("update licenses set plan='pro', seats=?, license_key=?, renew_source=?, issued_at=? where user_id=?")
      .bind(PLAN_RULES.pro.seats, makeLicenseKey("pro"), source, ts, userId)
      .run();
  } else {
    await env.DB
      .prepare(
        "insert into licenses (id,user_id,license_key,plan,status,seats,issued_at,expires_at,renew_source) values (?,?,?,'pro','active',?,?,null,?)",
      )
      .bind(crypto.randomUUID(), userId, makeLicenseKey("pro"), PLAN_RULES.pro.seats, ts, source)
      .run();
  }
  await env.DB.prepare("update users set plan='pro' where id=?").bind(userId).run();
  // 席位从 1 扩到 3，已激活设备保留
}

export const onRequest = () => fail("方法不允许", 405);

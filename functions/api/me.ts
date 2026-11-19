// GET /api/me  →  用户 + 授权 + 设备席位 + 结账入口
import {
  type Env,
  PLAN_RULES,
  authUser,
  fail,
  getLicense,
  isDev,
  listDevices,
  now,
  ok,
  publicLicense,
} from "../_shared";

export const onRequestGet = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);

  const lic = await getLicense(env, u.id);
  const devices = lic ? await listDevices(env, lic.id) : [];
  const rule = PLAN_RULES[lic?.plan || "basic"]!;

  return ok({
    user: { id: u.id, account: u.account, email: u.email, phone: u.phone, avatar: u.avatar ?? null, status: u.status },
    license: publicLicense(lic),
    usage: { used: devices.length, seats: lic?.seats ?? rule.seats },
    devices: devices.map((d: any) => ({ ...d, expired: d.last_seen_at < now() - 30 * 86400e3 })),
    checkout: {
      pro_url: env.CREEM_CHECKOUT_PRO || "",
      pro_product: env.CREEM_PRODUCT_PRO || "",
      mock_available: isDev(env) && lic?.plan !== "pro",
      note: env.CREEM_PRODUCT_PRO || env.CREEM_CHECKOUT_PRO
        ? "已配置真实结账入口，付款后由回调自动开通"
        : "未配置 CREEM_PRODUCT_PRO，当前可用模拟付款体验自动开通流程",
    },
  });
};

export const onRequest = () => fail("方法不允许", 405);

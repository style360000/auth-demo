// POST /api/webhook/creem —— 支付回调（自动交付的核心）
// 幂等三保险：
//   1) HMAC 验签：伪造请求直接 401
//   2) 事件 ID 主键去重：平台重复推送不会二次开通
//   3) 按事件类型分发：entitle 升级、refund/cancel 降级
import { type Env, audit, fail, getLicense, hmacSha256Hex, json, now, ok } from "../../_shared";
import { grantPro } from "../upgrade";

const SIG_HEADER = "creem-signature";

async function verify(env: Env, raw: string, sig: string) {
  if (!env.CREEM_WEBHOOK_SECRET || !sig) return false;
  const a = await hmacSha256Hex(env.CREEM_WEBHOOK_SECRET, raw);
  if (a.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const ENTITLE = ["checkout.completed", "subscription.paid", "subscription.active", "subscription.updated"];
const REVOKE = ["subscription.canceled", "subscription.cancelled", "subscription.unpaid", "refund.completed"];

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const raw = await req.text();

  if (env.CREEM_WEBHOOK_SECRET) {
    const sig = req.headers.get(SIG_HEADER) || "";
    if (!(await verify(env, raw, sig))) return fail("签名校验失败", 401);
  }

  let e: any;
  try {
    e = JSON.parse(raw);
  } catch {
    return fail("非法 JSON", 400);
  }

  const eventId = String(e.id || "");
  const type = String(e.type || "");
  if (!eventId) return fail("缺少事件 ID", 400);

  // 事件 ID 去重：changes=0 说明这条事件以前就处理过
  try {
    const ins = await env.DB
      .prepare("insert into webhook_events (id,type,payload,processed,received_at) values (?,?,?,1,?)")
      .bind(eventId, type, raw, now())
      .run();
    if (((ins.meta as any)?.changes ?? 1) === 0) return ok({ ignored: "duplicate event" });
  } catch (err: any) {
    if (String(err?.message || "").toLowerCase().includes("unique")) return ok({ ignored: "duplicate event" });
    throw err;
  }

  const d = e.data || {};
  const customerRef = String(d.customer?.customer_ref || d.metadata?.user_ref || "");
  if (!customerRef) return ok({ ignored: "no user ref" });

  const lic = await getLicense(env, customerRef);
  if (!lic) return json({ handled: false, reason: "user not found" }, 410);

  if (ENTITLE.includes(type)) {
    if (lic.plan !== "pro") {
      await grantPro(env, customerRef, "webhook");
      await audit(env, customerRef, "pay.entitle", `${type} → 自动开通专业版`);
    }
  } else if (REVOKE.includes(type)) {
    await env.DB.prepare("update licenses set plan='basic', seats=1, renew_source=? where user_id=?")
      .bind("webhook", customerRef).run();
    await env.DB.prepare("update users set plan='basic' where id=?").bind(customerRef).run();
    await audit(env, customerRef, "pay.revoke", `${type} → 降级为普通版`);
  }

  return ok({ handled: true, type });
};

export const onRequest = () => fail("方法不允许", 405);

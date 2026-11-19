// POST /api/otp { target, scene }   scene: register | login
// 真实投递：邮箱走 sendMail()，手机号走 sendSms()。发送失败会回滚本次验证码并返回错误，
// 避免出现"用户拿不到码但库里已有一条待用验证码"的卡死状态。
import { type Env, fail, issueOtp, isDev, ok, readBody, validEmail, validPhone, voidOtp } from "../_shared";
import { channelStatus, sendMail, sendSms } from "../_notify";

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const b = await readBody(req);
  const target = String(b.target || "").trim().toLowerCase();
  const scene = String(b.scene || "register");

  if (!["register", "login"].includes(scene)) return fail("scene 只能是 register 或 login");
  if (!target) return fail("请填写邮箱或手机号");
  if (!validEmail(target) && !validPhone(target)) return fail("格式不正确：邮箱需含 @，手机号需 7–15 位数字");

  const isEmail = validEmail(target);

  // 场景一致性：注册要求未被占用，登录要求已存在
  if (scene === "register") {
    const col = isEmail ? "email" : "phone";
    const hit = await env.DB.prepare(`select id from users where ${col}=?`).bind(target).first();
    if (hit) return fail(isEmail ? "该邮箱已注册，请直接登录" : "该手机号已注册，请直接登录", 409);
  } else {
    const hit = await env.DB.prepare("select id from users where email=? or phone=?").bind(target, target).first();
    if (!hit) return fail("该账号未注册", 404);
  }

  const issued = await issueOtp(env, target, scene);
  if (issued.error) return fail(issued.error, 429);

  // ---- 真实发送 ----
  const sent = isEmail
    ? await sendMail(env, target, issued.code, scene, issued.ttl)
    : await sendSms(env, target, issued.code, scene, issued.ttl);

  if (!sent.ok) {
    const st = channelStatus(env);
    if (isDev(env)) {
      // 联调模式且通道未配：保留这条验证码并回显，方便自测后续流程
      return ok({
        sent: false,
        delivered: false,
        devCode: issued.code,
        provider: sent.provider,
        warning: sent.error,
        channel: st,
        note: "发送通道不可用，已回显验证码供本地联调。上线前必须配置真实通道并把 DEV_MODE 设为 0。",
      });
    }
    // 正式模式：发送失败即作废，不让验证码悬在库里
    await voidOtp(env, target, scene);
    return fail(sent.error || "验证码发送失败，请稍后重试", 502, {
      provider: sent.provider,
      channel: st,
      hint: isEmail
        ? "邮箱通道需在后台配置 RESEND_API_KEY / BREVO_API_KEY / SENDGRID_API_KEY 之一，并设置 MAIL_FROM"
        : "短信通道需先完成厂商签名与模板审核，再配置 SMS_PROVIDER / SMS_WEBHOOK_URL",
    });
  }

  return ok({
    sent: true,
    delivered: true,
    provider: sent.provider,
    channel_type: isEmail ? "email" : "sms",
    ttlMinutes: issued.ttl,
    masked_target: mask(target),
  });
};

function mask(t: string) {
  if (t.includes("@")) {
    const [n, d] = t.split("@");
    return (n.slice(0, 2) + "***@" + d) as string;
  }
  return t.slice(0, 3) + "****" + t.slice(-4);
}

// 通道自检：GET /api/otp?status=1 → 只读配置状态，不发送、不含密钥
export const onRequestGet = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = new URL(req.url);
  if (u.searchParams.get("status") !== "1") return fail("用法：GET /api/otp?status=1", 400);
  return ok({ channel: channelStatus(env) });
};

export const onRequest = () => fail("方法不允许", 405);

// 真实发送通道：邮件 + 短信
// 约束：Cloudflare Workers/Pages Functions 只能发 HTTPS 请求，无法开 SMTP 裸 TCP 连接，
//      也无法连短信网关 socket。因此邮件走厂商 HTTP API，短信走厂商 HTTP API 或自定义 webhook。
import { type Env, now } from "./_shared";

export interface SendResult {
  ok: boolean;
  provider: string;
  error: string;
}

const NO_PROVIDER: SendResult = { ok: false, provider: "none", error: "" };

// ---------- 邮件正文（模板放这里，改文案不用动逻辑） ----------
function mailHtml(code: string, scene: string, ttlMinutes: number) {
  const title = scene === "register" ? "注册验证码" : "登录验证码";
  return `<div style="font-family:-apple-system,'Segoe UI',sans-serif;background:#f4f6fb;padding:32px 16px">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e6e9f2">
    <div style="font-size:15px;color:#1a1f36;font-weight:700;margin-bottom:6px">${title}</div>
    <div style="font-size:13.5px;color:#6b7280;line-height:1.7;margin-bottom:20px">
      你正在${scene === "register" ? "注册授权平台" : "登录授权平台"}。
      下方验证码 <b>5 分钟内有效</b>，仅可使用一次。
    </div>
    <div style="text-align:center;background:#f0f3fa;border:1px dashed #c7d0e6;border-radius:10px;padding:18px;margin-bottom:20px">
      <span style="font-family:ui-monospace,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#2d55ff">${code}</span>
    </div>
    <div style="font-size:12.5px;color:#9aa3b8;line-height:1.7">
      如果这不是你本人的操作，说明有人拿到了你的邮箱地址，请忽略本邮件并检查账号安全。<br>
      本邮件由系统自动发送，请勿直接回复。
    </div>
  </div>
  <div style="text-align:center;color:#9aa3b8;font-size:11.5px;margin-top:16px">${new Date(now()).toISOString().slice(0, 10)}</div>
</div>`;
}

const subjectOf = (scene: string) => (scene === "register" ? "【授权平台】注册验证码" : "【授权平台】登录验证码");

async function post(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<SendResult> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    const text = await r.text().catch(() => "");
    if (!r.ok) return { ok: false, provider: label, error: `${label} 返回 ${r.status}: ${text.slice(0, 300)}` };
    return { ok: true, provider: label, error: "" };
  } catch (e: any) {
    return { ok: false, provider: label, error: `${label} 请求失败: ${e?.name || ""} ${e?.message || e}` };
  }
}

// ---------- 邮件：按已配置的密钥自动选厂商 ----------
export async function sendMail(env: Env, to: string, code: string, scene: string, ttlMinutes: number) {
  const from = env.MAIL_FROM || "";
  const fromName = env.MAIL_FROM_NAME || "授权平台";
  const subject = subjectOf(scene);
  const html = mailHtml(code, scene, ttlMinutes);

  // 1) Resend —— 推荐：有免费额度，配置最简单
  if (env.RESEND_API_KEY) {
    if (!from) return { ok: false, provider: "resend", error: "已设置 RESEND_API_KEY，但缺少 MAIL_FROM 发件地址" };
    return post("https://api.resend.com/emails", { authorization: `Bearer ${env.RESEND_API_KEY}` },
      { from, to: [to], subject, html }, "resend");
  }

  // 2) Brevo（原 Sendinblue）—— 免费 300 封/天，无需验证域名即可用默认发件人
  if (env.BREVO_API_KEY) {
    if (!from) return { ok: false, provider: "brevo", error: "已设置 BREVO_API_KEY，但缺少 MAIL_FROM 发件地址" };
    return post("https://api.brevo.com/v3/smtp/email", { "api-key": env.BREVO_API_KEY },
      { sender: { name: fromName, email: from }, to: [{ email: to }], subject, htmlContent: html }, "brevo");
  }

  // 3) SendGrid —— 免费 100 封/天，需验证发件域名（DVCS/SPF）
  if (env.SENDGRID_API_KEY) {
    if (!from) return { ok: false, provider: "sendgrid", error: "已设置 SENDGRID_API_KEY，但缺少 MAIL_FROM 发件地址" };
    return post("https://api.sendgrid.com/v3/mail/send", { authorization: `Bearer ${env.SENDGRID_API_KEY}` },
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: fromName },
        subject,
        content: [{ type: "text/html", value: html }],
      }, "sendgrid");
  }

  // 4) 自定义 HTTP 邮件服务（自建服务 / 企业内网邮件网关均可）
  if (env.MAIL_WEBHOOK_URL) {
    const h: Record<string, string> = {};
    if (env.MAIL_WEBHOOK_TOKEN) h.authorization = `Bearer ${env.MAIL_WEBHOOK_TOKEN}`;
    return post(env.MAIL_WEBHOOK_URL, h, { to, subject, html, code, scene }, "mail-webhook");
  }

  return { ...NO_PROVIDER, error: "邮件通道未配置：请设置 RESEND_API_KEY / BREVO_API_KEY / SENDGRID_API_KEY / MAIL_WEBHOOK_URL 中任意一个" };
}

// ---------- 短信：阿里云/腾讯云需厂商签名，这里先支持通用 webhook ----------
export async function sendSms(env: Env, to: string, code: string, scene: string, ttlMinutes: number) {
  if (env.SMS_PROVIDER === "webhook" && env.SMS_WEBHOOK_URL) {
    const h: Record<string, string> = {};
    if (env.SMS_WEBHOOK_TOKEN) h.authorization = `Bearer ${env.SMS_WEBHOOK_TOKEN}`;
    return post(env.SMS_WEBHOOK_URL, h, { to, code, scene, ttl_minutes: ttlMinutes }, "sms-webhook");
  }
  return {
    ...NO_PROVIDER,
    provider: "sms",
    error:
      "短信通道未配置。国内发送短信必须先在云厂商完成签名与模板资质审核（需营业执照/备案主体），" +
      "配好后设置 SMS_PROVIDER=webhook 与 SMS_WEBHOOK_URL，或告知我你的厂商以便接入官方签名算法。",
  };
}

// ---------- 当前通道状态（给前端/排查用，不回显密钥） ----------
export function channelStatus(env: Env) {
  const emailProviders = ["RESEND_API_KEY", "BREVO_API_KEY", "SENDGRID_API_KEY", "MAIL_WEBHOOK_URL"].filter(
    (k) => !!env[k as keyof Env],
  );
  const smsReady = env.SMS_PROVIDER === "webhook" && !!env.SMS_WEBHOOK_URL;
  return {
    email_configured: emailProviders.length > 0,
    email_provider: emailProviders[0] || "",
    sms_configured: smsReady,
    dev_mode: env.DEV_MODE === "1",
  };
}

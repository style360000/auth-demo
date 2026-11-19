// 通道诊断
// GET  /api/admin/channels?token=xxx   → 查看已配置哪些通道（不回显任何密钥）
// POST /api/admin/channels {token, to} → 真实发送一封测试验证码邮件，用于验证发信链路
import { type Env, fail, genCode6, ok, readBody, validEmail } from "../../_shared";
import { channelStatus, sendMail } from "../../_notify";

async function guard(env: Env, token: string) {
  if (env.DEV_MODE === "1") return "";
  if (!env.INIT_TOKEN) return "未设置 INIT_TOKEN 且非演示模式，诊断已关闭";
  if (token !== env.INIT_TOKEN) return "口令不正确";
  return "";
}

export const onRequestGet = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const url = new URL(req.url);
  const err = await guard(env, url.searchParams.get("token") || "");
  if (err) return fail(err, 403);
  return ok({ channel: channelStatus(env), mail_from: env.MAIL_FROM || "" });
};

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const b = await readBody(req);
  const err = await guard(env, String(b.token || ""));
  if (err) return fail(err, 403);

  const to = String(b.to || "").trim().toLowerCase();
  if (!validEmail(to)) return fail("请填写合法的测试收件邮箱");

  const code = genCode6();
  const sent = await sendMail(env, to, code, "register", 5);
  if (!sent.ok) return fail(sent.error, 502, { provider: sent.provider, channel: channelStatus(env) });

  return ok({
    delivered: true,
    provider: sent.provider,
    to_masked: to.replace(/^(..).+(@.*)$/, "$1***$2"),
    note: "若邮箱未收到，请检查发件域名的 SPF/DKIM 验证是否已完成，或查看厂商的投递日志/退信记录",
  });
};

export const onRequest = () => fail("方法不允许", 405);

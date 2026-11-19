// POST /api/logout
import { type Env, audit, authUser, clearCookie, destroySession, fail, ok } from "../_shared";

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  await destroySession(req, env);
  if (u) await audit(env, u.id, "logout", "会话已注销");
  return ok({ loggedOut: true }, { "set-cookie": clearCookie });
};

export const onRequest = () => fail("方法不允许", 405);

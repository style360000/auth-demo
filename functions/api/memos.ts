// 备忘录：仅当前登录用户可见，按 user_id 隔离
// GET    /api/memos          → 自己的全部备忘录（按更新时间倒序）
// POST   /api/memos          → 新建 { title?, content }
// PUT    /api/memos          → 更新 { id, title?, content }
// DELETE /api/memos?id=xxx   → 删除自己的某条
import { type Env, authUser, fail, now, ok, readBody, uid } from "../_shared";

const TITLE_MAX = 100;
const CONTENT_MAX = 5000;

export const onRequestGet = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);
  const r = await env.DB
    .prepare("select id, title, content, created_at, updated_at from memos where user_id=? order by updated_at desc")
    .bind(u.id)
    .all();
  return ok({ memos: r.results || [] });
};

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);
  const b = await readBody(req);
  const title = String(b.title || "").trim();
  const content = String(b.content || "").trim();
  if (!content) return fail("内容不能为空");
  if (title.length > TITLE_MAX) return fail(`标题最多 ${TITLE_MAX} 字`);
  if (content.length > CONTENT_MAX) return fail(`内容最多 ${CONTENT_MAX} 字`);
  const id = uid();
  const ts = now();
  await env.DB
    .prepare("insert into memos (id, user_id, title, content, created_at, updated_at) values (?,?,?,?,?,?)")
    .bind(id, u.id, title || null, content, ts, ts)
    .run();
  return ok({ memo: { id, title: title || null, content, created_at: ts, updated_at: ts } });
};

export const onRequestPut = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);
  const b = await readBody(req);
  const id = String(b.id || "").trim();
  if (!id) return fail("缺少 id");
  const title = String(b.title || "").trim();
  const content = String(b.content || "").trim();
  if (!content) return fail("内容不能为空");
  if (title.length > TITLE_MAX) return fail(`标题最多 ${TITLE_MAX} 字`);
  if (content.length > CONTENT_MAX) return fail(`内容最多 ${CONTENT_MAX} 字`);
  const ts = now();
  const r = await env.DB
    .prepare("update memos set title=?, content=?, updated_at=? where id=? and user_id=?")
    .bind(title || null, content, ts, id, u.id)
    .run();
  if (((r.meta as any)?.changes ?? 0) === 0) return fail("备忘录不存在或无权操作", 404);
  return ok({ memo: { id, title: title || null, content, updated_at: ts } });
};

export const onRequestDelete = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return fail("缺少 id");
  const r = await env.DB
    .prepare("delete from memos where id=? and user_id=?")
    .bind(id, u.id)
    .run();
  if (((r.meta as any)?.changes ?? 0) === 0) return fail("备忘录不存在或无权操作", 404);
  return ok({ deleted: true });
};

export const onRequest = () => fail("方法不允许", 405);

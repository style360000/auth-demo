// POST /api/avatar { avatar }   avatar = "preset:0..4" | "img:<dataURL>"
import { type Env, authUser, fail, ok, readBody } from "../_shared";

const IMG_MAX = 256 * 1024; // 整串（含前缀与 dataURL 头）长度上限

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);

  const b = await readBody(req);
  const avatar = String(b.avatar || "").trim();
  if (!avatar) return fail("缺少 avatar");

  const preset = /^preset:([0-4])$/.exec(avatar);
  if (!preset && !avatar.startsWith("img:")) return fail("avatar 需为 preset:0..4 或 img: 开头的图片");
  if (!preset) {
    if (avatar.length > IMG_MAX) return fail("图片过大，请换一张更小的");
    if (!/^img:data:image\/(png|jpe?g|webp|gif);base64,/.test(avatar)) return fail("仅支持 png/jpg/webp/gif 图片");
  }

  await env.DB.prepare("update users set avatar=? where id=?").bind(avatar, u.id).run();
  return ok({ avatar });
};

export const onRequest = () => fail("方法不允许", 405);

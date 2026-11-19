// 软件授权接口
// GET  /api/license                                  → 授权详情 + 已激活设备
// POST /api/license {action, device_id, device_name}  → activate | deactivate | verify
import {
  type Env,
  PLAN_RULES,
  audit,
  authUser,
  fail,
  getLicense,
  listDevices,
  now,
  ok,
  publicLicense,
  readBody,
  uid,
} from "../_shared";

const SEAT_PLAN = (plan: string) => PLAN_RULES[plan] || PLAN_RULES.basic;

export const onRequestGet = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);
  const lic = await getLicense(env, u.id);
  if (!lic) return fail("未找到授权记录", 404);
  const devices = await listDevices(env, lic.id);
  return ok({
    license: publicLicense(lic),
    devices: devices.map((d: any) => ({ ...d, stale: d.last_seen_at < now() - 30 * 86400e3 })),
    usage: { used: devices.length, seats: lic.seats ?? SEAT_PLAN(lic.plan).seats },
  });
};

export const onRequestPost = async (ctx: { request: Request; env: Env }) => {
  const { request: req, env } = ctx;
  const u = await authUser(req, env);
  if (!u) return fail("未登录", 401);

  const b = await readBody(req);
  const action = String(b.action || "activate");
  const deviceId = String(b.device_id || "").trim();
  if (!deviceId) return fail("缺少 device_id（客户端需上报稳定的设备标识）");

  const lic = await getLicense(env, u.id);
  if (!lic) return fail("未找到授权记录", 404);
  if (lic.status !== "active") return fail("授权已冻结，请联系管理员", 403);
  if (lic.expires_at && lic.expires_at < now()) return fail("授权已到期，请续费", 403);

  const rule = SEAT_PLAN(lic.plan);
  const devices = await listDevices(env, lic.id);
  const exist = devices.find((d: any) => d.device_id === deviceId);

  if (action === "deactivate") {
    if (!exist) return fail("该设备未在本授权下激活", 404);
    await env.DB.prepare("delete from activations where license_id=? and device_id=?").bind(lic.id, deviceId).run();
    await audit(env, u.id, "deactivate", `解绑设备 ${deviceId}`);
    return ok({ deactivated: deviceId, usage: { used: devices.length - 1, seats: lic.seats ?? rule.seats } });
  }

  if (action === "verify") {
    if (!exist) return fail("该设备未激活，请先激活", 404);
    await env.DB
      .prepare("update activations set last_seen_at=? where license_id=? and device_id=?")
      .bind(now(), lic.id, deviceId)
      .run();
    return ok({ valid: true, license: publicLicense(lic) });
  }

  // activate
  if (exist) {
    await env.DB
      .prepare("update activations set last_seen_at=?, device_name=? where license_id=? and device_id=?")
      .bind(now(), String(b.device_name || "") || exist.device_name, lic.id, deviceId)
      .run();
    return ok({ already: true, license: publicLicense(lic) });
  }

  const seats = lic.seats ?? rule.seats;
  if (devices.length >= seats) {
    const tip =
      lic.plan === "pro"
        ? `已达到 ${seats} 台设备上限。请先在「设备管理」解绑不常用的设备。`
        : `已占满 ${seats} 个设备席位（${rule.label}）。请解绑其他设备，或升级到专业版（3 台）。`;
    return fail(tip, 403, { seats, used: devices.length });
  }

  await env.DB
    .prepare(
      "insert into activations (id,license_id,device_id,device_name,activated_at,last_seen_at) values (?,?,?,?,?,?)",
    )
    .bind(uid(), lic.id, deviceId, String(b.device_name || "") || "未命名设备", now(), now())
    .run();
  await audit(env, u.id, "activate", `设备 ${deviceId} 激活成功（${devices.length + 1}/${seats}）`);
  const after = await listDevices(env, lic.id);
  return ok({ activated: true, license: publicLicense(lic), usage: { used: after.length, seats } });
};

export const onRequest = () => fail("方法不允许", 405);

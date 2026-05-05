import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { logger } from "../logger.js";
import {
  createTotpAccount,
  getTotpAccountByName,
  listTotpAccounts,
  deleteTotpAccount,
  markTotpUsed,
  addTotpAudit,
  getTotpAudit,
} from "../db.js";
import {
  encrypt,
  decrypt,
  generateTotp,
  isValidName,
  isValidBase32,
} from "../totp.js";

const router: Router = express.Router();

// --- Schemas ---

const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  secret: z.string().min(8).max(512),  // base32, longer than 8 chars
  issuer: z.string().max(200).optional().nullable(),
  digits: z.number().int().min(6).max(8).optional(),
  period: z.number().int().min(15).max(120).optional(),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional(),
  agent_id: z.string().max(100).optional().nullable(),
});

// --- Routes ---

// POST /api/totp/accounts — provision new TOTP secret
router.post("/accounts", validate(createAccountSchema), (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof createAccountSchema>;

  if (!isValidName(body.name)) {
    res.status(400).json({ error: "Invalid name (allowed: a-zA-Z0-9_.:-, length 1-100)" });
    return;
  }
  if (!isValidBase32(body.secret)) {
    res.status(400).json({ error: "Secret must be valid base32 (RFC 4648, A-Z and 2-7)" });
    return;
  }

  // Verify the secret actually generates a code (catches malformed-but-valid-base32)
  try {
    generateTotp({ secret: body.secret, digits: body.digits, period: body.period, algorithm: body.algorithm });
  } catch (e: unknown) {
    res.status(400).json({ error: `Secret rejected: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }

  const env = encrypt(body.secret.toUpperCase().replace(/[\s=]+/g, ""));

  const result = createTotpAccount({
    name: body.name,
    secret_encrypted: env.ciphertext,
    iv: env.iv,
    auth_tag: env.authTag,
    issuer: body.issuer,
    digits: body.digits,
    period: body.period,
    algorithm: body.algorithm,
    agent_id: body.agent_id,
  });

  if (!result.ok) {
    if (result.reason === "duplicate") {
      res.status(409).json({ error: "Account name already exists" });
      return;
    }
  }

  addTotpAudit({
    account_name: body.name,
    action: "create",
    agent_id: body.agent_id ?? null,
    ip: req.ip ?? null,
  });

  logger.info({ name: body.name, agent_id: body.agent_id }, "TOTP account created");
  res.json({ ok: true, name: body.name });
});

// GET /api/totp/accounts — list accounts (no secrets, no codes)
router.get("/accounts", (_req: Request, res: Response) => {
  const accounts = listTotpAccounts();
  res.json({ data: accounts });
});

// GET /api/totp/accounts/:name/code — generate current code, log access
router.get("/accounts/:name/code", (req: Request, res: Response) => {
  const name = String(req.params.name ?? "");
  if (!isValidName(name)) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }

  const row = getTotpAccountByName(name);
  if (!row) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  let secret: string;
  try {
    secret = decrypt({
      ciphertext: row.secret_encrypted,
      iv: row.iv,
      authTag: row.auth_tag,
    });
  } catch (err) {
    logger.error({ err, name }, "TOTP secret decryption failed (key mismatch?)");
    res.status(500).json({ error: "Decryption failed — master key may have changed. Restore from backup or re-provision." });
    return;
  }

  const code = generateTotp({
    secret,
    digits: row.digits,
    period: row.period,
    algorithm: row.algorithm as "SHA1" | "SHA256" | "SHA512",
  });

  const agentId = (req.query.agent_id as string | undefined) ?? null;
  markTotpUsed(name, agentId);
  addTotpAudit({
    account_name: name,
    action: "code_fetched",
    agent_id: agentId,
    ip: req.ip ?? null,
  });

  res.json({
    code: code.code,
    valid_for_seconds: code.validForSeconds,
    period: code.period,
  });
});

// DELETE /api/totp/accounts/:name — remove account
router.delete("/accounts/:name", (req: Request, res: Response) => {
  const name = String(req.params.name ?? "");
  if (!isValidName(name)) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }
  const removed = deleteTotpAccount(name);
  if (!removed) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const agentId = (req.query.agent_id as string | undefined) ?? null;
  addTotpAudit({
    account_name: name,
    action: "delete",
    agent_id: agentId,
    ip: req.ip ?? null,
  });
  logger.info({ name, agent_id: agentId }, "TOTP account deleted");
  res.json({ ok: true });
});

// GET /api/totp/audit?account=<name>&limit=N — audit log
router.get("/audit", (req: Request, res: Response) => {
  const account = req.query.account as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const rows = getTotpAudit({ account, limit: Number.isFinite(limit) ? limit : 100 });
  res.json({ data: rows });
});

export default router;

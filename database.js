const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const enabled = Boolean(process.env.DATABASE_URL);
const pool = enabled ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 10 }) : null;

async function query(text, values) { if (!pool) throw new Error('DATABASE_URL is not configured'); return pool.query(text, values); }
async function getBalance(userCode) { const result = await query('SELECT balance FROM users WHERE external_code = $1', [userCode]); return Number(result.rows[0]?.balance || 0); }
async function applyWalletTransaction({ userCode, externalId, amount, kind, provider, metadata = {} }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const duplicate = await client.query('SELECT balance_after FROM wallet_transactions WHERE external_id = $1 FOR UPDATE', [externalId]);
    if (duplicate.rowCount) { await client.query('COMMIT'); return { duplicate: true, balance: Number(duplicate.rows[0].balance_after) }; }
    await client.query('INSERT INTO users (external_code) VALUES ($1) ON CONFLICT (external_code) DO NOTHING', [userCode]);
    const user = await client.query('SELECT id,balance FROM users WHERE external_code = $1 FOR UPDATE', [userCode]);
    const before = Number(user.rows[0].balance); const change = Number(amount); const after = Math.round((before + change) * 100) / 100;
    if (after < 0) { await client.query('ROLLBACK'); return { insufficient: true, balance: before }; }
    await client.query('UPDATE users SET balance = $1, updated_at = now() WHERE id = $2', [after, user.rows[0].id]);
    await client.query('INSERT INTO wallet_transactions (user_id,external_id,kind,amount,balance_before,balance_after,status,provider,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [user.rows[0].id, externalId, kind, change, before, after, 'success', provider, JSON.stringify(metadata)]);
    await client.query('COMMIT'); return { balance: after };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function authenticateAdmin(email, password) { const result = await query('SELECT id,email,password_hash,role,totp_secret,totp_enabled FROM admin_users WHERE lower(email)=lower($1)', [email]); const admin = result.rows[0]; if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return null; await query('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [admin.id]); return { id: admin.id, email: admin.email, role: admin.role, totpEnabled: admin.totp_enabled, totpSecret: admin.totp_secret }; }
async function getAdmin(id){const r=await query('SELECT id,email,role,totp_secret,totp_enabled FROM admin_users WHERE id=$1',[id]);return r.rows[0]}
async function saveTotp(id,secret){await query('UPDATE admin_users SET totp_secret=$1,totp_enabled=false WHERE id=$2',[secret,id])}
async function enableTotp(id){await query('UPDATE admin_users SET totp_enabled=true WHERE id=$1',[id])}
async function createAdmin(email, password, role = 'super_admin') { const hash = await bcrypt.hash(password, 12); const result = await query('INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role', [email, hash, role]); return result.rows[0]; }
async function createUser(email, password) { const hash = await bcrypt.hash(password, 12); const result = await query('INSERT INTO users (external_code,email,password_hash) VALUES($1,$2,$3) RETURNING id,external_code,email,currency,balance,kyc_status', [`user_${require('crypto').randomUUID()}`, email.toLowerCase(), hash]); return result.rows[0]; }
async function authenticateUser(email, password) { const result = await query('SELECT id,external_code,email,password_hash,currency,balance,kyc_status FROM users WHERE lower(email)=lower($1)', [email]); const user=result.rows[0]; if(!user || !user.password_hash || !(await bcrypt.compare(password,user.password_hash))) return null; delete user.password_hash; return user; }
async function createAffiliate(code,name,rate){const r=await query('INSERT INTO affiliates(code,name,commission_rate) VALUES($1,$2,$3) RETURNING *',[code.toUpperCase(),name,rate]);return r.rows[0]}
async function listAffiliates(){const r=await query('SELECT a.*,count(ar.id)::int AS referrals FROM affiliates a LEFT JOIN affiliate_referrals ar ON ar.affiliate_id=a.id GROUP BY a.id ORDER BY a.created_at DESC');return r.rows}
module.exports = { enabled, query, getBalance, applyWalletTransaction, authenticateAdmin, createAdmin, createUser, authenticateUser, createAffiliate, listAffiliates, getAdmin, saveTotp, enableTotp };

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
    if (kind === 'bet' || kind === 'win') { const affiliate = await client.query('SELECT u.affiliate_id,a.commission_rate FROM users u LEFT JOIN affiliates a ON a.id=u.affiliate_id WHERE u.id=$1', [user.rows[0].id]); const row=affiliate.rows[0]; if(row?.affiliate_id){ const ggr=kind==='bet' ? Math.abs(change) : -Math.abs(change); const rate=Number(row.commission_rate); const commission=Math.round(ggr*rate)/100; await client.query('INSERT INTO affiliate_commissions(affiliate_id,user_id,external_id,ggr_amount,commission_rate,commission_amount,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(external_id) DO NOTHING',[row.affiliate_id,user.rows[0].id,`affiliate:${externalId}`,ggr,rate,commission,'pending']); } }
    await client.query('COMMIT'); return { balance: after };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function authenticateAdmin(email, password) { const result = await query('SELECT id,email,password_hash,role,totp_secret,totp_enabled FROM admin_users WHERE lower(email)=lower($1)', [email]); const admin = result.rows[0]; if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return null; await query('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [admin.id]); return { id: admin.id, email: admin.email, role: admin.role, totpEnabled: admin.totp_enabled, totpSecret: admin.totp_secret }; }
async function getAdmin(id){const r=await query('SELECT id,email,role,totp_secret,totp_enabled FROM admin_users WHERE id=$1',[id]);return r.rows[0]}
async function saveTotp(id,secret){await query('UPDATE admin_users SET totp_secret=$1,totp_enabled=false WHERE id=$2',[secret,id])}
async function enableTotp(id){await query('UPDATE admin_users SET totp_enabled=true WHERE id=$1',[id])}
async function createAdmin(email, password, role = 'super_admin') { const hash = await bcrypt.hash(password, 12); const result = await query('INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role', [email, hash, role]); return result.rows[0]; }
async function createUser(email, password, currency = 'AZN', country = 'AZ', language = 'az', referralCode = '') { const hash = await bcrypt.hash(password, 12); const result = await query('INSERT INTO users (external_code,email,password_hash,currency,country_code,language_code) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,external_code,email,currency,country_code,language_code,balance,kyc_status', [`user_${require('crypto').randomUUID()}`, email.toLowerCase(), hash, currency, country, language]); const code=String(referralCode||'').toUpperCase(); if(code){const a=await query('SELECT id FROM affiliates WHERE code=$1 AND status=\'active\'',[code]);if(a.rowCount)await query('INSERT INTO affiliate_referrals(affiliate_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[a.rows[0].id,result.rows[0].id])} return result.rows[0]; }
async function authenticateUser(email, password) { const result = await query('SELECT id,external_code,email,password_hash,currency,balance,kyc_status FROM users WHERE lower(email)=lower($1)', [email]); const user=result.rows[0]; if(!user || !user.password_hash || !(await bcrypt.compare(password,user.password_hash))) return null; delete user.password_hash; return user; }
async function createAffiliate(code,name,rate){const r=await query('INSERT INTO affiliates(code,name,commission_rate) VALUES($1,$2,$3) RETURNING *',[code.toUpperCase(),name,rate]);return r.rows[0]}
async function listAffiliates(){const r=await query('SELECT a.*,(SELECT count(*)::int FROM affiliate_referrals ar WHERE ar.affiliate_id=a.id) AS referrals,(SELECT COALESCE(sum(commission_amount),0) FROM affiliate_commissions ac WHERE ac.affiliate_id=a.id) AS earnings FROM affiliates a ORDER BY a.created_at DESC');return r.rows}
async function createBonus(title,kind,amount,wager){const r=await query('INSERT INTO bonuses(title,kind,amount,wager_multiplier) VALUES($1,$2,$3,$4) RETURNING *',[title,kind,amount,wager]);return r.rows[0]}
async function listBonuses(){const r=await query('SELECT * FROM bonuses ORDER BY created_at DESC');return r.rows}
async function createPromo(code,bonusId,limit,expires){const r=await query('INSERT INTO promo_codes(code,bonus_id,usage_limit,expires_at) VALUES($1,$2,$3,$4) RETURNING *',[code.toUpperCase(),bonusId||null,limit||null,expires||null]);return r.rows[0]}
async function listPromos(){const r=await query('SELECT p.*,b.title AS bonus_title FROM promo_codes p LEFT JOIN bonuses b ON b.id=p.bonus_id ORDER BY p.created_at DESC');return r.rows}
async function listProviderControls(){const r=await query('SELECT * FROM provider_controls ORDER BY name');return r.rows}
async function setProviderControl(code,name,enabled,mode){const r=await query('INSERT INTO provider_controls(code,name,enabled,mode) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO UPDATE SET enabled=$3,mode=$4,name=$2,updated_at=now() RETURNING *',[code,name,enabled,mode]);return r.rows[0]}
async function listPaymentControls(){const r=await query('SELECT * FROM payment_controls ORDER BY name');return r.rows}
async function setPaymentControl(code,name,enabled,mode,currency='AZN'){const r=await query('INSERT INTO payment_controls(code,name,enabled,mode,currency) VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO UPDATE SET enabled=$3,mode=$4,name=$2,currency=$5,updated_at=now() RETURNING *',[code,name,enabled,mode,currency]);return r.rows[0]}
async function listUsers(){const r=await query('SELECT id,external_code,email,currency,balance,kyc_status,created_at FROM users ORDER BY created_at DESC LIMIT 500');return r.rows}
 module.exports = { enabled, query, getBalance, applyWalletTransaction, authenticateAdmin, createAdmin, createUser, authenticateUser, createAffiliate, listAffiliates, createBonus, listBonuses, createPromo, listPromos, listProviderControls, setProviderControl, listPaymentControls, setPaymentControl, listUsers, getAdmin, saveTotp, enableTotp };

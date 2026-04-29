require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');

const { initDatabase } = require('./db');
const { initHandler } = require('./ipLookup');
const { processCampaign } = require('./processor');
const { generateClientXLSX } = require('./excelExport');
const { GoPhishClient } = require('./gophishApi');

const app = express();
const PORT = process.env.PORT || 3000;

const db = initDatabase();

if (process.env.IPINFO_TOKEN) {
    initHandler(process.env.IPINFO_TOKEN);
}

// ============================================================
// Authentication
// ============================================================
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || 'secret';
const CLIENT_NAME = process.env.CLIENT_NAME || '';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

function signToken(username) {
    const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString('base64');
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

function verifyToken(token) {
    if (!token) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    if (sig !== expected) return null;
    try { return JSON.parse(Buffer.from(payload, 'base64').toString()); } catch { return null; }
}

app.use(express.json());

// Auth endpoints (before static middleware)
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === AUTH_USER && password === AUTH_PASS) {
        const token = signToken(username);
        res.cookie('auth_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
    const token = parseCookie(req.headers.cookie || '', 'auth_token');
    const user = verifyToken(token);
    res.json({ authenticated: !!user, username: user?.u || null });
});

// App config (public)
app.get('/api/config', (req, res) => {
    res.json({ clientName: CLIENT_NAME });
});

function parseCookie(cookieHeader, name) {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

// Auth middleware — protect everything except login page & auth API
app.use((req, res, next) => {
    // Allow auth endpoints and config
    if (req.path.startsWith('/api/auth/') || req.path === '/api/config') return next();
    // Allow login page (self-contained, no external assets needed)
    if (req.path === '/login.html') return next();
    // Allow public shared dashboard
    if (req.path.startsWith('/api/shared/') || req.path.startsWith('/shared/')) return next();

    const token = parseCookie(req.headers.cookie || '', 'auth_token');
    const user = verifyToken(token);

    if (!user) {
        // API requests get 401, page requests redirect to login
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
        return res.redirect('/login.html');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname)
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
        else cb(new Error('Only CSV files are allowed'));
    },
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ============================================================
// Settings
// ============================================================
const SETTING_KEYS = ['ipinfo_token', 'gophish_api_key', 'gophish_server_url', 'auto_refresh_interval', 'share_link_expiry_days'];

app.get('/api/settings', (req, res) => {
    const settings = {};
    for (const key of SETTING_KEYS) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        settings[key] = row?.value || '';
    }
    // Fallback to env vars
    if (!settings.ipinfo_token) settings.ipinfo_token = process.env.IPINFO_TOKEN || '';
    if (!settings.gophish_api_key) settings.gophish_api_key = process.env.GOPHISH_API_KEY || '';
    if (!settings.gophish_server_url) settings.gophish_server_url = process.env.GOPHISH_SERVER_URL || '';
    if (!settings.auto_refresh_interval) settings.auto_refresh_interval = '60';
    if (!settings.share_link_expiry_days) settings.share_link_expiry_days = '0'; // 0 = never
    res.json(settings);
});

app.put('/api/settings', (req, res) => {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction((data) => {
        for (const key of SETTING_KEYS) {
            if (data[key] !== undefined) {
                upsert.run(key, data[key]);
            }
        }
    });
    transaction(req.body);

    // Re-init handlers if relevant keys changed
    if (req.body.ipinfo_token) initHandler(req.body.ipinfo_token);

    res.json({ success: true });
});

app.get('/api/settings/test-gophish', async (req, res) => {
    try {
        const apiKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('gophish_api_key')?.value || process.env.GOPHISH_API_KEY;
        const serverUrl = db.prepare('SELECT value FROM settings WHERE key = ?').get('gophish_server_url')?.value || process.env.GOPHISH_SERVER_URL;

        if (!apiKey || !serverUrl) {
            return res.json({ success: false, error: 'GoPhish API key and server URL are required' });
        }

        // Use dynamic import for node-fetch or use built-in https
        const https = require('https');
        const url = new URL('/api/campaigns/?api_key=' + apiKey, serverUrl);

        const result = await new Promise((resolve, reject) => {
            const req = https.get(url, { rejectUnauthorized: false, timeout: 10000 }, (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ status: response.statusCode, campaigns: Array.isArray(parsed) ? parsed.length : 0 });
                    } catch {
                        resolve({ status: response.statusCode, error: 'Invalid JSON response' });
                    }
                });
            });
            req.on('error', (e) => reject(e));
            req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
        });

        if (result.status === 200) {
            res.json({ success: true, message: `Connected! Found ${result.campaigns} campaign(s)`, campaigns: result.campaigns });
        } else {
            res.json({ success: false, error: `HTTP ${result.status}: ${result.error || 'Unauthorized'}` });
        }
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============================================================
// Clients
// ============================================================
app.get('/api/clients', (req, res) => {
    const clients = db.prepare(`
        SELECT c.*, COUNT(camp.id) as campaign_count,
               COALESCE(SUM(camp.total_targets), 0) as total_targets
        FROM clients c
        LEFT JOIN campaigns camp ON camp.client_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `).all();
    res.json(clients);
});

app.post('/api/clients', (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Client name is required' });
    const result = db.prepare('INSERT INTO clients (name) VALUES (?)').run(name.trim());
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/clients/:id', (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Client name is required' });
    db.prepare('UPDATE clients SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
    res.json({ success: true });
});

app.delete('/api/clients/:id', (req, res) => {
    db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ============================================================
// Client Export (XLSX)
// ============================================================
app.get('/api/clients/:id/export', async (req, res) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const buffer = await generateClientXLSX(db, client.id);
        const filename = client.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}_Phishing_Report.xlsx"`);
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error('[Export] XLSX generation failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Campaigns (under clients)
// ============================================================
app.get('/api/clients/:clientId/campaigns', (req, res) => {
    const campaigns = db.prepare(`
        SELECT * FROM campaigns WHERE client_id = ? ORDER BY created_at DESC
    `).all(req.params.clientId);
    res.json(campaigns);
});

app.get('/api/campaigns', (req, res) => {
    const campaigns = db.prepare(`
        SELECT c.*, cl.name as client_name FROM campaigns c
        LEFT JOIN clients cl ON cl.id = c.client_id
        ORDER BY c.created_at DESC
    `).all();
    res.json(campaigns);
});

app.get('/api/campaigns/:id', (req, res) => {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
});

app.post('/api/campaigns', upload.fields([
    { name: 'eventsFile', maxCount: 1 },
    { name: 'resultsFile', maxCount: 1 }
]), async (req, res) => {
    try {
        const { name, clientId, excludeOrgs, ipinfoToken } = req.body;

        if (!clientId) return res.status(400).json({ error: 'Client ID is required' });
        if (!req.files?.eventsFile || !req.files?.resultsFile) {
            return res.status(400).json({ error: 'Both CSV files are required' });
        }

        const eventsPath = req.files.eventsFile[0].path;
        const resultsPath = req.files.resultsFile[0].path;

        if (ipinfoToken) {
            initHandler(ipinfoToken);
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ipinfo_token', ipinfoToken);
        } else {
            const saved = db.prepare('SELECT value FROM settings WHERE key = ?').get('ipinfo_token');
            if (saved?.value) initHandler(saved.value);
        }

        let excludeOrgsList = [];
        if (excludeOrgs) {
            try { excludeOrgsList = JSON.parse(excludeOrgs); }
            catch { excludeOrgsList = excludeOrgs.split(',').map(s => s.trim()).filter(Boolean); }
        }

        const result = db.prepare('INSERT INTO campaigns (client_id, name, exclude_orgs) VALUES (?, ?, ?)').run(
            clientId, name || 'Campaign', JSON.stringify(excludeOrgsList)
        );
        const campaignId = result.lastInsertRowid;
        const processResult = await processCampaign(db, campaignId, eventsPath, resultsPath, excludeOrgsList);

        try { fs.unlinkSync(eventsPath); fs.unlinkSync(resultsPath); } catch {}

        res.json({ success: true, campaignId, ...processResult });
    } catch (err) {
        console.error('[API] Campaign creation failed:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/campaigns/:id', (req, res) => {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// List all campaigns for a client (including gophish_id)
app.get('/api/clients/:id/campaigns', (req, res) => {
    const campaigns = db.prepare('SELECT * FROM campaigns WHERE client_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json(campaigns);
});

// ============================================================
// GoPhish API Sync
// ============================================================
function getGoPhishClient() {
    const apiKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('gophish_api_key')?.value || process.env.GOPHISH_API_KEY;
    const serverUrl = db.prepare('SELECT value FROM settings WHERE key = ?').get('gophish_server_url')?.value || process.env.GOPHISH_SERVER_URL;
    if (!apiKey || !serverUrl) throw new Error('GoPhish API key and server URL must be configured in Settings');
    return new GoPhishClient(serverUrl, apiKey);
}

// List available campaigns from GoPhish
app.get('/api/gophish/campaigns', async (req, res) => {
    try {
        const client = getGoPhishClient();
        const campaigns = await client.getCampaigns();
        // Return simplified list for the UI picker
        const list = campaigns.map(c => {
            const scenarioMatch = c.name.match(/\(([^)]+?)\s+Scenario\)/i);
            return {
                id: c.id,
                name: c.name,
                displayName: scenarioMatch ? scenarioMatch[1].trim() : c.name,
                status: c.status,
                created_date: c.created_date,
                launch_date: c.launch_date,
            };
        });
        res.json(list);
    } catch (err) {
        console.error('[GoPhish API]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Sync selected campaigns from GoPhish into our DB
app.post('/api/gophish/sync', async (req, res) => {
    try {
        const { clientId, campaignIds } = req.body;
        if (!clientId) return res.status(400).json({ error: 'Client ID is required' });
        if (!campaignIds?.length) return res.status(400).json({ error: 'Select at least one campaign' });

        const gp = getGoPhishClient();
        const results = [];

        for (const gpCampaignId of campaignIds) {
            try {
                console.log(`[GoPhish Sync] Fetching campaign ${gpCampaignId}...`);
                const rawCampaign = await gp.getCampaign(gpCampaignId);
                const transformed = GoPhishClient.transformCampaign(rawCampaign);

                // Create campaign in our DB
                const insertResult = db.prepare(
                    'INSERT INTO campaigns (client_id, name, total_targets, total_events, stats_sent, stats_opened, stats_clicked, stats_submitted, gophish_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                ).run(
                    clientId,
                    transformed.displayName,
                    transformed.stats.total_targets,
                    transformed.totalEvents,
                    transformed.stats.stats_sent,
                    transformed.stats.stats_opened,
                    transformed.stats.stats_clicked,
                    transformed.stats.stats_submitted,
                    gpCampaignId
                );
                const localCampaignId = insertResult.lastInsertRowid;

                // Insert summary rows
                const insertSummary = db.prepare(
                    'INSERT INTO summary (campaign_id, email, rid, email_sent, email_opened, clicked_link, submitted_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
                );
                const summaryTx = db.transaction((rows) => {
                    for (const s of rows) {
                        insertSummary.run(localCampaignId, s.email, s.rid, s.email_sent, s.email_opened, s.clicked_link, s.submitted_data);
                    }
                });
                summaryTx(transformed.summary);

                // Insert events
                const insertEvent = db.prepare(
                    'INSERT INTO events (campaign_id, email, rid, message, time_formatted, time_raw, user_agent, ip_address, ip_details, is_valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                const eventsTx = db.transaction((rows) => {
                    for (const e of rows) {
                        insertEvent.run(localCampaignId, e.email, e.rid, e.message, e.time_formatted, e.time_raw, e.user_agent, e.ip_address, e.ip_details, e.is_valid);
                    }
                });
                eventsTx(transformed.events);

                // Insert submitted data
                if (transformed.submittedData.length > 0) {
                    const insertSubmitted = db.prepare(
                        'INSERT INTO submitted_data (campaign_id, email, rid, time_formatted, field_name, field_value) VALUES (?, ?, ?, ?, ?, ?)'
                    );
                    const subTx = db.transaction((rows) => {
                        for (const d of rows) {
                            insertSubmitted.run(localCampaignId, d.email, d.rid, d.time_formatted, d.field_name, d.field_value);
                        }
                    });
                    subTx(transformed.submittedData);
                }

                console.log(`[GoPhish Sync] ✅ ${transformed.displayName}: ${transformed.stats.total_targets} targets, ${transformed.totalEvents} events`);
                results.push({ gpId: gpCampaignId, localId: localCampaignId, name: transformed.displayName, success: true });
            } catch (err) {
                console.error(`[GoPhish Sync] ❌ Campaign ${gpCampaignId}:`, err.message);
                results.push({ gpId: gpCampaignId, success: false, error: err.message });
            }
        }

        res.json({ success: true, results });
    } catch (err) {
        console.error('[GoPhish Sync]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Dashboard Aggregation
// ============================================================
app.get('/api/clients/:id/dashboard', (req, res) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const campaigns = db.prepare('SELECT * FROM campaigns WHERE client_id = ? ORDER BY created_at DESC').all(req.params.id);

        // Aggregate stats
        const totals = { targets: 0, sent: 0, opened: 0, clicked: 0, submitted: 0 };
        const perCampaign = campaigns.map(c => {
            totals.targets += c.total_targets || 0;
            totals.sent += c.stats_sent || 0;
            totals.opened += c.stats_opened || 0;
            totals.clicked += c.stats_clicked || 0;
            totals.submitted += c.stats_submitted || 0;
            return {
                id: c.id, name: c.name,
                targets: c.total_targets || 0,
                sent: c.stats_sent || 0,
                opened: c.stats_opened || 0,
                clicked: c.stats_clicked || 0,
                submitted: c.stats_submitted || 0,
            };
        });

        res.json({ client, totals, campaigns: perCampaign });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Campaign Detail (events, summary, submitted)
// ============================================================
app.get('/api/campaigns/:id/events', (req, res) => {
    const { message, valid, email, page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = 'SELECT * FROM events WHERE campaign_id = ?';
    let countQuery = 'SELECT COUNT(*) as total FROM events WHERE campaign_id = ?';
    const params = [req.params.id];
    if (message) { query += ' AND message = ?'; countQuery += ' AND message = ?'; params.push(message); }
    if (valid !== undefined) { query += ' AND is_valid = ?'; countQuery += ' AND is_valid = ?'; params.push(parseInt(valid)); }
    if (email) { query += ' AND email LIKE ?'; countQuery += ' AND email LIKE ?'; params.push(`%${email}%`); }
    const total = db.prepare(countQuery).get(...params).total;
    query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    const events = db.prepare(query).all(...params, parseInt(limit), offset);
    res.json({ events, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
});

app.get('/api/campaigns/:id/summary', (req, res) => {
    const { email } = req.query;
    let query = 'SELECT * FROM summary WHERE campaign_id = ?';
    const params = [req.params.id];
    if (email) { query += ' AND email LIKE ?'; params.push(`%${email}%`); }
    query += ' ORDER BY id ASC';
    res.json(db.prepare(query).all(...params));
});

app.get('/api/campaigns/:id/submitted', (req, res) => {
    const submitted = db.prepare('SELECT * FROM submitted_data WHERE campaign_id = ? ORDER BY email, id ASC').all(req.params.id);
    const grouped = {};
    for (const row of submitted) {
        if (!grouped[row.email]) grouped[row.email] = { email: row.email, rid: row.rid, time: row.time_formatted, fields: {} };
        grouped[row.email].fields[row.field_name] = row.field_value;
    }
    res.json({ raw: submitted, grouped: Object.values(grouped) });
});

// Per-user timeline: LIVE from GoPhish API
app.get('/api/campaigns/:id/timeline', async (req, res) => {
    try {
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        if (!campaign.gophish_id) return res.json({ users: [], total: 0, source: 'none', message: 'This campaign was imported via CSV. Timeline is only available for GoPhish API-synced campaigns.' });

        const gp = getGoPhishClient();
        const gpCampaign = await gp.getCampaign(campaign.gophish_id);

        const results = gpCampaign.results || [];
        const timeline = gpCampaign.timeline || [];
        const { search } = req.query;

        // Build per-user timeline from GoPhish API data
        const users = results.map(r => {
            // Get this user's events from timeline
            const userEvents = timeline.filter(t => t.email === r.email && t.message !== 'Campaign Created');

            // Build events with dedup
            const deduped = [];
            const seenSubmitTimes = new Set();
            for (const t of userEvents) {
                let details = {};
                try { details = JSON.parse(t.details || '{}'); } catch {}
                const browser = details?.browser || {};
                const ip = browser.address || '';
                const ua = browser['user-agent'] || '';

                // Parse UA
                let browserName = 'Unknown', os = 'Unknown';
                if (ua.includes('Edge')) browserName = 'Edge';
                else if (ua.includes('Chrome')) browserName = 'Chrome';
                else if (ua.includes('Firefox')) browserName = 'Firefox';
                else if (ua.includes('Safari')) browserName = 'Safari';
                if (ua.includes('Windows 10')) os = 'Windows 10';
                else if (ua.includes('Windows')) os = 'Windows';
                else if (ua.includes('Mac')) os = 'macOS';
                else if (ua.includes('Linux')) os = 'Linux';
                else if (ua.includes('Android')) os = 'Android';
                else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

                // Format time to WIB
                let time = '';
                try {
                    const d = new Date(t.time);
                    time = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }) + ', ' +
                           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
                } catch { time = t.time; }

                // Skip duplicate Submitted Data per timestamp
                if (t.message === 'Submitted Data') {
                    if (seenSubmitTimes.has(time)) continue;
                    seenSubmitTimes.add(time);
                }

                const evt = { message: t.message, time, ip, os, browser: browserName };

                // Attach submitted fields
                if (t.message === 'Submitted Data') {
                    const payload = details?.payload || {};
                    const fields = {};
                    for (const [key, values] of Object.entries(payload)) {
                        if (key === 'rid') continue;
                        fields[key] = Array.isArray(values) ? values.join(', ') : String(values);
                    }
                    evt.submittedFields = fields;
                }

                deduped.push(evt);
            }

            // Group identical submissions
            const final = [];
            const submittedGroups = [];
            for (const evt of deduped) {
                if (evt.message === 'Submitted Data' && evt.submittedFields) {
                    const fieldKey = JSON.stringify(evt.submittedFields);
                    const existing = submittedGroups.find(g => g.key === fieldKey);
                    if (existing) {
                        existing.count++;
                    } else {
                        const group = { key: fieldKey, count: 1 };
                        submittedGroups.push(group);
                        final.push(evt);
                        evt._groupRef = group;
                    }
                } else {
                    final.push(evt);
                }
            }
            for (const evt of final) {
                if (evt._groupRef) {
                    evt.submitCount = evt._groupRef.count;
                    delete evt._groupRef;
                }
            }

            return {
                email: r.email,
                rid: r.id,
                firstName: r.first_name || '',
                lastName: r.last_name || '',
                position: r.position || '',
                status: r.status,
                events: final,
            };
        });

        // Filter
        let filtered = users;
        if (search) {
            const q = search.toLowerCase();
            filtered = users.filter(u =>
                u.email.toLowerCase().includes(q) ||
                u.firstName.toLowerCase().includes(q) ||
                u.lastName.toLowerCase().includes(q)
            );
        }

        res.json({ users: filtered, total: users.length, source: 'gophish_api' });
    } catch (err) {
        console.error('[Timeline API]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Legacy export (ZIP)
app.get('/api/campaigns/:id/export', (req, res) => {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const events = db.prepare('SELECT * FROM events WHERE campaign_id = ? ORDER BY id').all(req.params.id);
    const summary = db.prepare('SELECT * FROM summary WHERE campaign_id = ? ORDER BY id').all(req.params.id);
    const validEvents = events.filter(e => e.is_valid);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${campaign.name.replace(/[^a-zA-Z0-9]/g, '_')}_export.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.append(validEvents.map(e => e.rid).join('\n'), { name: 'raw_activity_rid.txt' });
    archive.append(validEvents.map(e => e.email).join('\n'), { name: 'raw_activity_email.txt' });
    archive.append(validEvents.map(e => e.time_formatted).join('\n'), { name: 'raw_activity_time.txt' });
    archive.append(validEvents.map(e => e.message).join('\n'), { name: 'raw_activity_status.txt' });
    archive.append(validEvents.map(e => e.user_agent).join('\n'), { name: 'raw_activity_ua.txt' });
    archive.append(validEvents.map(e => e.ip_address).join('\n'), { name: 'raw_activity_ip.txt' });
    archive.append(validEvents.map(e => e.ip_details).join('\n'), { name: 'raw_activity_ip-details.txt' });
    archive.append(summary.map(s => s.rid).join('\n'), { name: 'summary-rid.txt' });
    archive.append(summary.map(s => s.email).join('\n'), { name: 'summary-email.txt' });
    archive.append(summary.map(s => s.email_sent).join('\n'), { name: 'summary-sent.txt' });
    archive.append(summary.map(s => s.email_opened).join('\n'), { name: 'summary-read.txt' });
    archive.append(summary.map(s => s.clicked_link).join('\n'), { name: 'summary-clicked.txt' });
    archive.append(summary.map(s => s.submitted_data).join('\n'), { name: 'summary-submitted.txt' });
    archive.finalize();
});

// ============================================================
// Share Links
// ============================================================

app.post('/api/clients/:id/share', (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE clients SET share_token = ?, share_created_at = datetime(?) WHERE id = ?')
        .run(token, new Date().toISOString(), req.params.id);
    res.json({ success: true, token, url: `/shared/${token}` });
});

app.delete('/api/clients/:id/share', (req, res) => {
    db.prepare('UPDATE clients SET share_token = NULL, share_created_at = NULL WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.get('/api/clients/:id/share', (req, res) => {
    const client = db.prepare('SELECT share_token, share_created_at FROM clients WHERE id = ?').get(req.params.id);
    res.json({ token: client?.share_token || null, created: client?.share_created_at || null });
});

// Public shared dashboard API
app.get('/api/shared/:token', (req, res) => {
    const client = db.prepare('SELECT * FROM clients WHERE share_token = ?').get(req.params.token);
    if (!client) return res.status(404).json({ error: 'Invalid or expired share link' });

    // Check expiry
    const expiryDays = parseInt(db.prepare('SELECT value FROM settings WHERE key = ?').get('share_link_expiry_days')?.value || '0');
    if (expiryDays > 0 && client.share_created_at) {
        const created = new Date(client.share_created_at);
        const now = new Date();
        const diffDays = (now - created) / (1000 * 60 * 60 * 24);
        if (diffDays > expiryDays) {
            return res.status(410).json({ error: 'Share link has expired' });
        }
    }

    const campaigns = db.prepare('SELECT * FROM campaigns WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
    const totals = { targets: 0, sent: 0, opened: 0, clicked: 0, submitted: 0 };
    const perCampaign = campaigns.map(c => {
        totals.targets += c.total_targets || 0;
        totals.sent += c.stats_sent || 0;
        totals.opened += c.stats_opened || 0;
        totals.clicked += c.stats_clicked || 0;
        totals.submitted += c.stats_submitted || 0;
        return { name: c.name, targets: c.total_targets || 0, sent: c.stats_sent || 0, opened: c.stats_opened || 0, clicked: c.stats_clicked || 0, submitted: c.stats_submitted || 0 };
    });

    res.json({ clientName: client.name, totals, campaigns: perCampaign });
});

// Shared page route
app.get('/shared/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shared.html')));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
    console.error('[Error]', err);
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
    res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎯 GoPhish Analyzer running at http://0.0.0.0:${PORT}\n`);
});

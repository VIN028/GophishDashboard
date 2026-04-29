const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');

function initDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const dbPath = path.join(DATA_DIR, 'analyzer.db');
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            share_token TEXT,
            share_created_at DATETIME,
            created_at DATETIME DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            exclude_orgs TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT (datetime('now')),
            total_targets INTEGER DEFAULT 0,
            total_events INTEGER DEFAULT 0,
            stats_sent INTEGER DEFAULT 0,
            stats_opened INTEGER DEFAULT 0,
            stats_clicked INTEGER DEFAULT 0,
            stats_submitted INTEGER DEFAULT 0,
            gophish_id INTEGER,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL,
            email TEXT,
            rid TEXT,
            message TEXT,
            time_formatted TEXT,
            time_raw TEXT,
            user_agent TEXT,
            ip_address TEXT,
            ip_details TEXT,
            is_valid INTEGER DEFAULT 1,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS summary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL,
            email TEXT,
            rid TEXT,
            email_sent TEXT DEFAULT 'No',
            email_opened TEXT DEFAULT 'No',
            clicked_link TEXT DEFAULT 'No',
            submitted_data TEXT DEFAULT 'No',
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS submitted_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL,
            email TEXT,
            rid TEXT,
            time_formatted TEXT,
            field_name TEXT,
            field_value TEXT,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_summary_campaign ON summary(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_submitted_campaign ON submitted_data(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns(client_id);
    `);

    // Migration: add client_id if campaigns table exists without it
    try {
        const cols = db.prepare("PRAGMA table_info(campaigns)").all();
        const hasClientId = cols.some(c => c.name === 'client_id');
        if (!hasClientId) {
            // Create a default client for existing campaigns
            db.exec(`
                INSERT OR IGNORE INTO clients (id, name) VALUES (1, 'Default Client');
                ALTER TABLE campaigns ADD COLUMN client_id INTEGER DEFAULT 1 REFERENCES clients(id);
            `);
            console.log('[DB] Migrated: added client_id to campaigns');
        }
    } catch (e) {
        // Column already exists or table doesn't exist yet
    }

    // Migration: add share_token to clients
    try {
        const clientCols = db.prepare("PRAGMA table_info(clients)").all();
        if (!clientCols.some(c => c.name === 'share_token')) {
            db.exec('ALTER TABLE clients ADD COLUMN share_token TEXT');
            db.exec('ALTER TABLE clients ADD COLUMN share_created_at DATETIME');
            console.log('[DB] Migrated: added share_token to clients');
        }
    } catch (e) {}

    // Migration: add gophish_id to campaigns
    try {
        const campCols = db.prepare("PRAGMA table_info(campaigns)").all();
        if (!campCols.some(c => c.name === 'gophish_id')) {
            db.exec('ALTER TABLE campaigns ADD COLUMN gophish_id INTEGER');
            console.log('[DB] Migrated: added gophish_id to campaigns');
        }
    } catch (e) {}

    console.log('[DB] Database initialized successfully');
    return db;
}

module.exports = { initDatabase };

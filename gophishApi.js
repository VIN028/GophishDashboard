/**
 * GoPhish API Client
 * Connects to GoPhish REST API to fetch campaign data directly
 */

const https = require('https');
const http = require('http');

class GoPhishClient {
    constructor(serverUrl, apiKey) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        // GoPhish uses self-signed SSL by default
        this.agent = new https.Agent({ rejectUnauthorized: false });
    }

    /**
     * Make an API request to GoPhish
     */
    async request(endpoint) {
        const url = new URL(endpoint, this.serverUrl);
        url.searchParams.set('api_key', this.apiKey);

        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        return new Promise((resolve, reject) => {
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000,
            };
            if (isHttps) options.agent = this.agent;

            const req = lib.get(url, isHttps ? { rejectUnauthorized: false, timeout: 15000 } : { timeout: 15000 }, (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        return reject(new Error(`GoPhish API returned HTTP ${response.statusCode}: ${data}`));
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error('Invalid JSON response from GoPhish'));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('GoPhish connection timeout')); });
        });
    }

    /** Get all campaigns */
    async getCampaigns() {
        return this.request('/api/campaigns/');
    }

    /** Get a single campaign with full details (results + timeline) */
    async getCampaign(id) {
        return this.request(`/api/campaigns/${id}`);
    }

    /** Get campaign summary (stats only) */
    async getCampaignSummary(id) {
        return this.request(`/api/campaigns/${id}/summary`);
    }

    /** Get campaign results only */
    async getCampaignResults(id) {
        return this.request(`/api/campaigns/${id}/results`);
    }

    /**
     * Transform GoPhish campaign data into our app's schema
     * @param {Object} campaign - Full campaign object from GoPhish API
     * @returns {Object} Transformed data ready for our DB
     */
    static transformCampaign(campaign) {
        const results = campaign.results || [];
        const timeline = campaign.timeline || [];

        // Extract scenario name from campaign name: "(XXX Scenario)"
        const scenarioMatch = campaign.name.match(/\(([^)]+?)\s+Scenario\)/i);
        const displayName = scenarioMatch ? scenarioMatch[1].trim() : campaign.name;

        // Build summary (per-target status)
        const summaryMap = {};
        for (const r of results) {
            const rid = r.id;
            summaryMap[rid] = {
                email: r.email,
                rid: rid,
                first_name: r.first_name,
                last_name: r.last_name,
                status: r.status,
                email_sent: 'No',
                email_opened: 'No',
                clicked_link: 'No',
                submitted_data: 'No',
            };

            // Derive from status (GoPhish statuses are cumulative)
            const st = (r.status || '').toLowerCase();
            if (st.includes('submitted')) {
                summaryMap[rid].email_sent = 'Yes';
                summaryMap[rid].email_opened = 'Yes';
                summaryMap[rid].clicked_link = 'Yes';
                summaryMap[rid].submitted_data = 'Yes';
            } else if (st.includes('clicked')) {
                summaryMap[rid].email_sent = 'Yes';
                summaryMap[rid].email_opened = 'Yes';
                summaryMap[rid].clicked_link = 'Yes';
            } else if (st.includes('opened')) {
                summaryMap[rid].email_sent = 'Yes';
                summaryMap[rid].email_opened = 'Yes';
            } else if (st.includes('sent') || st.includes('sending')) {
                summaryMap[rid].email_sent = 'Yes';
            }
        }

        // Build events from timeline
        const events = [];
        for (const t of timeline) {
            if (!t.email || t.message === 'Campaign Created') continue;

            let details = {};
            try { details = JSON.parse(t.details || '{}'); } catch {}

            const rid = details?.payload?.rid?.[0] || '';
            const browser = details?.browser || {};
            const ip = browser.address || '';
            const ua = browser['user-agent'] || '';

            // Format time to WIB (UTC+7)
            let timeFormatted = '';
            try {
                const d = new Date(t.time);
                timeFormatted = d.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
            } catch {
                timeFormatted = t.time;
            }

            events.push({
                email: t.email,
                rid: rid,
                message: t.message,
                time_formatted: timeFormatted,
                time_raw: t.time,
                user_agent: ua,
                ip_address: ip,
                ip_details: '',
                is_valid: 1,
            });
        }

        // Build submitted data from timeline "Submitted Data" events
        const submittedData = [];
        for (const t of timeline) {
            if (t.message !== 'Submitted Data') continue;
            let details = {};
            try { details = JSON.parse(t.details || '{}'); } catch {}

            const rid = details?.payload?.rid?.[0] || '';
            const payload = details?.payload || {};

            let timeFormatted = '';
            try {
                const d = new Date(t.time);
                timeFormatted = d.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
            } catch {
                timeFormatted = t.time;
            }

            // Extract form fields (everything except rid)
            for (const [key, values] of Object.entries(payload)) {
                if (key === 'rid') continue;
                const val = Array.isArray(values) ? values.join(', ') : String(values);
                submittedData.push({
                    email: t.email,
                    rid: rid,
                    time_formatted: timeFormatted,
                    field_name: key,
                    field_value: val,
                });
            }
        }

        // Stats
        const summaryArray = Object.values(summaryMap);
        const stats = {
            total_targets: summaryArray.length,
            stats_sent: summaryArray.filter(s => s.email_sent === 'Yes').length,
            stats_opened: summaryArray.filter(s => s.email_opened === 'Yes').length,
            stats_clicked: summaryArray.filter(s => s.clicked_link === 'Yes').length,
            stats_submitted: summaryArray.filter(s => s.submitted_data === 'Yes').length,
        };

        return {
            displayName,
            originalName: campaign.name,
            summary: summaryArray,
            events,
            submittedData,
            stats,
            totalEvents: events.length,
        };
    }
}

module.exports = { GoPhishClient };

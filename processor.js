const { parseResultsCSV, parseEventsCSV } = require('./csvParser');
const { getIpDetails, clearCache } = require('./ipLookup');

function parseDetails(details) {
    if (!details) {
        return { rid: '-', userAgent: '-', ipAddress: '-' };
    }
    try {
        const cleaned = details.replace(/'/g, '"');
        const parsed = JSON.parse(cleaned);
        const rid = parsed?.payload?.rid?.[0] || '-';
        const userAgent = parsed?.browser?.['user-agent'] || '-';
        const ipAddress = (parsed?.browser?.address || '-').toLowerCase();
        return { rid, userAgent, ipAddress };
    } catch (err) {
        return { rid: '-', userAgent: '-', ipAddress: '-' };
    }
}

function formatTimeToWIB(timeStr) {
    if (!timeStr) return '-';
    try {
        const trimmed = timeStr.replace(/(\.\d{3})\d*Z$/, '$1Z');
        const date = new Date(trimmed);
        if (isNaN(date.getTime())) return timeStr;

        date.setHours(date.getHours() + 7);

        const day = String(date.getUTCDate()).padStart(2, '0');
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const month = months[date.getUTCMonth()];
        const year = date.getUTCFullYear();
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');

        return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`;
    } catch {
        return timeStr;
    }
}

async function processCampaign(db, campaignId, eventsPath, resultsPath, excludeOrgs = []) {
    clearCache();

    const eventRows = parseEventsCSV(eventsPath);
    const resultRows = parseResultsCSV(resultsPath);
    console.log(`[Processor] Events: ${eventRows.length}, Results: ${resultRows.length}`);

    // STEP 1: Process events with IP validation
    const insertEvent = db.prepare(`
        INSERT INTO events (campaign_id, email, rid, message, time_formatted, time_raw, user_agent, ip_address, ip_details, is_valid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const processedEvents = [];

    for (let i = 0; i < eventRows.length; i++) {
        const row = eventRows[i];
        const { rid, userAgent, ipAddress } = parseDetails(row.details);
        const formattedTime = formatTimeToWIB(row.time);
        const { details: ipDetails, isValid } = await getIpDetails(ipAddress, excludeOrgs);

        insertEvent.run(
            campaignId,
            (row.email || '-').toLowerCase(),
            rid, row.message || '-',
            formattedTime, row.time || '-',
            userAgent, ipAddress, ipDetails,
            isValid ? 1 : 0
        );

        processedEvents.push({
            email: (row.email || '-').toLowerCase(),
            message: row.message || '-',
            isValid
        });
    }

    // STEP 2: Generate summary per email
    const insertSummary = db.prepare(`
        INSERT INTO summary (campaign_id, email, rid, email_sent, email_opened, clicked_link, submitted_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let statsSent = 0, statsOpened = 0, statsClicked = 0, statsSubmitted = 0;

    for (const result of resultRows) {
        const email = (result.email || '').toLowerCase();
        const rid = result.id || '-';
        const statuses = { 'Email Sent': 'No', 'Email Opened': 'No', 'Clicked Link': 'No', 'Submitted Data': 'No' };

        for (const event of processedEvents) {
            if (event.email === email && event.message in statuses && event.isValid) {
                statuses[event.message] = 'Yes';
            }
        }

        insertSummary.run(campaignId, email, rid, statuses['Email Sent'], statuses['Email Opened'], statuses['Clicked Link'], statuses['Submitted Data']);

        if (statuses['Email Sent'] === 'Yes') statsSent++;
        if (statuses['Email Opened'] === 'Yes') statsOpened++;
        if (statuses['Clicked Link'] === 'Yes') statsClicked++;
        if (statuses['Submitted Data'] === 'Yes') statsSubmitted++;
    }

    // STEP 3: Process submitted data (with IP filtering fix)
    const insertSubmitted = db.prepare(`
        INSERT INTO submitted_data (campaign_id, email, rid, time_formatted, field_name, field_value)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const seenEmails = new Set();

    for (const row of eventRows) {
        if (row.message === 'Submitted Data') {
            const email = (row.email || '').toLowerCase();
            if (seenEmails.has(email)) continue;
            seenEmails.add(email);

            try {
                const cleaned = (row.details || '').replace(/'/g, '"');
                const parsed = JSON.parse(cleaned);
                const payload = parsed?.payload || {};
                const rid = payload.rid?.[0] || '-';
                const formattedTime = formatTimeToWIB(row.time);

                const ipAddress = (parsed?.browser?.address || '-').toLowerCase();
                const { isValid } = await getIpDetails(ipAddress, excludeOrgs);
                if (!isValid) continue;

                for (const [key, value] of Object.entries(payload)) {
                    if (key !== 'rid') {
                        const cleanValue = String(value?.[0] || '').replace(/\n/g, ' ').replace(/\r/g, ' ').trim();
                        insertSubmitted.run(campaignId, email, rid, formattedTime, key, cleanValue);
                    }
                }
            } catch (err) {
                console.warn(`[Processor] Failed to parse submitted data for ${email}:`, err.message);
            }
        }
    }

    // STEP 4: Update campaign stats
    db.prepare(`
        UPDATE campaigns SET total_targets = ?, total_events = ?, stats_sent = ?, stats_opened = ?, stats_clicked = ?, stats_submitted = ?
        WHERE id = ?
    `).run(resultRows.length, eventRows.length, statsSent, statsOpened, statsClicked, statsSubmitted, campaignId);

    return { totalTargets: resultRows.length, totalEvents: eventRows.length, statsSent, statsOpened, statsClicked, statsSubmitted };
}

module.exports = { processCampaign, parseDetails, formatTimeToWIB };

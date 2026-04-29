// ============================================================
// GoPhish Analyzer — Frontend App v2 (Client → Campaign flow)
// ============================================================

let currentClientId = null;
let currentClientName = '';
let currentCampaignId = null;
let currentSummaryData = [];
let currentEventsData = [];
let eventsPage = 1;
let debounceTimer = null;
const excludeOrgTags = [];
let editClientId = null;

async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

// ============================================================
// View Navigation
// ============================================================
function showView(view) {
    ['view-clients', 'view-client-detail', 'view-new-campaign', 'view-campaign-detail'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });

    if (view === 'clients') {
        document.getElementById('view-clients').style.display = 'block';
        loadClients();
    } else if (view === 'client-detail') {
        document.getElementById('view-client-detail').style.display = 'block';
        loadClientCampaigns();
        switchPanel('panel-dashboard');
    } else if (view === 'new-campaign') {
        document.getElementById('view-new-campaign').style.display = 'block';
        document.getElementById('new-campaign-client-name').textContent = `for ${currentClientName}`;
        loadSavedToken();
    } else if (view === 'campaign-detail') {
        document.getElementById('view-campaign-detail').style.display = 'block';
    }
}

function backToClientDetail() { showView('client-detail'); }

// ============================================================
// Projects
// ============================================================

// Load CLIENT_NAME from server config
(async function loadAppConfig() {
    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        if (cfg.clientName) {
            document.getElementById('nav-client-name').textContent = cfg.clientName + ' — ';
            document.title = cfg.clientName + ' — GoPhish Analyzer';
        }
    } catch {}
})();

async function loadClients() {
    try {
        const res = await fetch('/api/clients');
        const clients = await res.json();
        const grid = document.getElementById('clients-grid');
        const empty = document.getElementById('empty-clients');

        if (clients.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
        empty.style.display = 'none';

        grid.innerHTML = clients.map(c => {
            const date = new Date(c.created_at + 'Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            return `
            <div class="campaign-card" onclick="openClient(${c.id}, '${esc(c.name)}')">
                <div class="campaign-card-header">
                    <div>
                        <div class="campaign-card-title">${esc(c.name)}</div>
                        <div class="campaign-card-date">${date}</div>
                    </div>
                    <button class="campaign-card-delete" onclick="event.stopPropagation(); showDeleteModal('client', ${c.id}, '${esc(c.name)}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
                <div class="campaign-card-meta">
                    <span>📊 ${c.campaign_count} campaign${c.campaign_count !== 1 ? 's' : ''}</span>
                    <span>👥 ${c.total_targets} total targets</span>
                </div>
            </div>`;
        }).join('');
    } catch (err) { toast('Failed to load projects: ' + err.message, 'error'); }
}

function openClient(id, name) {
    currentClientId = id;
    currentClientName = name;
    document.getElementById('client-detail-name').textContent = name;
    showView('client-detail');
}

async function loadClientCampaigns() {
    try {
        const res = await fetch(`/api/clients/${currentClientId}/campaigns`);
        const campaigns = await res.json();
        const grid = document.getElementById('campaigns-grid');
        const empty = document.getElementById('empty-campaigns');

        if (campaigns.length === 0) {
            grid.innerHTML = ''; empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        grid.innerHTML = campaigns.map(c => {
            const date = new Date(c.created_at + 'Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            return `
            <div class="campaign-card" onclick="viewCampaign(${c.id})">
                <div class="campaign-card-header">
                    <div>
                        <div class="campaign-card-title">${esc(c.name)}</div>
                        <div class="campaign-card-date">${date}</div>
                    </div>
                    <button class="campaign-card-delete" onclick="event.stopPropagation(); showDeleteModal('campaign', ${c.id}, '${esc(c.name)}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
                <div class="campaign-card-stats">
                    <div class="campaign-mini-stat"><div class="mini-value mini-sent">${c.stats_sent}</div><div class="mini-label">Sent</div></div>
                    <div class="campaign-mini-stat"><div class="mini-value mini-opened">${c.stats_opened}</div><div class="mini-label">Opened</div></div>
                    <div class="campaign-mini-stat"><div class="mini-value mini-clicked">${c.stats_clicked}</div><div class="mini-label">Clicked</div></div>
                    <div class="campaign-mini-stat"><div class="mini-value mini-submitted">${c.stats_submitted}</div><div class="mini-label">Submitted</div></div>
                </div>
                <div class="campaign-card-meta">
                    <span>👥 ${c.total_targets} targets</span>
                    <span>📊 ${c.total_events} events</span>
                </div>
            </div>`;
        }).join('');
    } catch (err) { toast('Failed to load campaigns: ' + err.message, 'error'); }
}

// ============================================================
// Sidebar Panel Switching
// ============================================================
let activeGpCampaignLocalId = null;

function switchPanel(panelId) {
    // Update sidebar nav
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-panel="${panelId}"]`)?.classList.add('active');

    // Update panels
    document.querySelectorAll('.client-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(panelId)?.classList.add('active');

    // Show/hide GoPhish campaign list in sidebar
    const gpSection = document.getElementById('sidebar-gp-campaigns');
    if (panelId === 'panel-gophish') {
        gpSection.style.display = 'block';
        loadGophishCampaignsList();
    } else {
        gpSection.style.display = 'none';
    }

    // Load dashboard data on first visit
    if (panelId === 'panel-dashboard') {
        loadDashboard();
    }
}

async function loadGophishCampaignsList() {
    const listEl = document.getElementById('sidebar-gp-list');
    // Get campaigns that have gophish_id from our DB
    try {
        const res = await fetch(`/api/clients/${currentClientId}/campaigns`);
        const campaigns = await res.json();
        const gpCampaigns = campaigns.filter(c => c.gophish_id);

        if (gpCampaigns.length === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.8rem">No GoPhish campaigns synced yet.<br>Click Sync to import.</div>';
            return;
        }

        listEl.innerHTML = gpCampaigns.map(c => `
            <div class="sidebar-campaign-item ${activeGpCampaignLocalId === c.id ? 'active' : ''}" onclick="selectGpCampaign(${c.id}, '${esc(c.name)}')">
                <span class="sbc-name">${esc(c.name)}</span>
                <span class="sbc-status">${c.total_targets} targets · ${c.stats_submitted} submitted</span>
            </div>
        `).join('');
    } catch (err) { toast('Failed to load campaigns list: ' + err.message, 'error'); }
}

function selectGpCampaign(localId, name) {
    activeGpCampaignLocalId = localId;
    currentCampaignId = localId;

    // Update sidebar active state
    document.querySelectorAll('.sidebar-campaign-item').forEach(el => el.classList.remove('active'));
    event.currentTarget?.classList.add('active');

    // Show timeline view
    document.getElementById('gp-live-empty').style.display = 'none';
    document.getElementById('gp-timeline-view').style.display = 'block';
    document.getElementById('gp-timeline-name').textContent = name;

    // Load timeline from API
    loadTimeline();
}

// ============================================================
// Dashboard Charts
// ============================================================
let funnelChart = null;
let scenariosChart = null;
let dashboardRefreshTimer = null;
let dashboardData = null;
let activeDashCampaignId = null; // null = all

async function loadDashboard() {
    try {
        const res = await fetch(`/api/clients/${currentClientId}/dashboard`);
        dashboardData = await res.json();

        // Render filter tabs
        renderDashboardFilter(dashboardData.campaigns);

        // Render stats for current filter
        renderDashboardStats();

        // Setup auto-refresh
        setupAutoRefresh();

        // Load share status
        loadShareStatus();
    } catch (err) { console.error('[Dashboard]', err); }
}

function renderDashboardFilter(campaigns) {
    let filterEl = document.getElementById('dash-filter');
    if (!filterEl) {
        filterEl = document.createElement('div');
        filterEl.id = 'dash-filter';
        filterEl.className = 'dash-filter';
        const dashboard = document.getElementById('client-dashboard');
        dashboard.insertBefore(filterEl, dashboard.firstChild);
    }

    filterEl.innerHTML = `<button class="dash-filter-btn ${activeDashCampaignId === null ? 'active' : ''}" onclick="filterDashboard(null)">All Campaigns</button>` +
        campaigns.map(c => `<button class="dash-filter-btn ${activeDashCampaignId === c.id ? 'active' : ''}" onclick="filterDashboard(${c.id})">${esc(c.name)}</button>`).join('');
}

function filterDashboard(campaignId) {
    activeDashCampaignId = campaignId;
    renderDashboardFilter(dashboardData.campaigns);
    renderDashboardStats();
}

function renderDashboardStats() {
    if (!dashboardData) return;

    let t;
    if (activeDashCampaignId === null) {
        t = dashboardData.totals;
    } else {
        const c = dashboardData.campaigns.find(c => c.id === activeDashCampaignId);
        t = c ? { targets: c.targets, sent: c.sent, opened: c.opened, clicked: c.clicked, submitted: c.submitted } : dashboardData.totals;
    }

    animateCounter('dash-targets', t.targets);
    animateCounter('dash-sent', t.sent);
    animateCounter('dash-opened', t.opened);
    animateCounter('dash-clicked', t.clicked);
    animateCounter('dash-submitted', t.submitted);

    // Percentages
    const pct = (v) => t.targets > 0 ? ((v / t.targets) * 100).toFixed(1) + '%' : '-';
    document.getElementById('dash-pct-sent').textContent = pct(t.sent);
    document.getElementById('dash-pct-opened').textContent = pct(t.opened);
    document.getElementById('dash-pct-clicked').textContent = pct(t.clicked);
    document.getElementById('dash-pct-submitted').textContent = pct(t.submitted);

    renderFunnelChart(t);

    // Bar chart + scenario table: only in "All" view
    const barCard = document.getElementById('chart-scenarios')?.closest('.chart-card');
    const tableCard = document.getElementById('scenario-table-card');
    if (activeDashCampaignId === null) {
        if (barCard) barCard.style.display = 'block';
        if (tableCard) tableCard.style.display = 'block';
        renderScenariosChart(dashboardData.campaigns);
        renderScenarioTable(dashboardData.campaigns, dashboardData.totals);
    } else {
        if (barCard) barCard.style.display = 'none';
        if (tableCard) tableCard.style.display = 'none';
    }
}

function renderScenarioTable(campaigns, totals) {
    const tbody = document.getElementById('scenario-summary-tbody');
    tbody.innerHTML = campaigns.map(c => `
        <tr>
            <td>${esc(c.name)}</td>
            <td>${c.targets}</td>
            <td>${c.sent}</td>
            <td>${c.opened}</td>
            <td>${c.clicked}</td>
            <td>${c.submitted}</td>
        </tr>
    `).join('') + `
        <tr class="total-row">
            <td>Total</td>
            <td>${totals.targets}</td>
            <td>${totals.sent}</td>
            <td>${totals.opened}</td>
            <td>${totals.clicked}</td>
            <td>${totals.submitted}</td>
        </tr>`;
}

function animateCounter(id, target) {
    const el = document.getElementById(id);
    const start = parseInt(el.textContent) || 0;
    const duration = 800;
    const startTime = performance.now();
    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(start + (target - start) * eased);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function renderFunnelChart(totals) {
    const ctx = document.getElementById('chart-funnel');
    if (funnelChart) funnelChart.destroy();

    funnelChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Sent Only', 'Opened', 'Clicked', 'Submitted'],
            datasets: [{
                data: [
                    Math.max(0, totals.sent - totals.opened),
                    Math.max(0, totals.opened - totals.clicked),
                    Math.max(0, totals.clicked - totals.submitted),
                    totals.submitted,
                ],
                backgroundColor: ['#3b82f6', '#f59e0b', '#f97316', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#9ca3af', font: { size: 11 }, padding: 12, usePointStyle: true }
                }
            }
        }
    });
}

function renderScenariosChart(campaigns) {
    const ctx = document.getElementById('chart-scenarios');
    if (scenariosChart) scenariosChart.destroy();

    scenariosChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: campaigns.map(c => c.name),
            datasets: [
                { label: 'Sent', data: campaigns.map(c => c.sent), backgroundColor: '#3b82f6' },
                { label: 'Opened', data: campaigns.map(c => c.opened), backgroundColor: '#f59e0b' },
                { label: 'Clicked', data: campaigns.map(c => c.clicked), backgroundColor: '#f97316' },
                { label: 'Submitted', data: campaigns.map(c => c.submitted), backgroundColor: '#ef4444' },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(75,85,99,0.2)' } },
                y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(75,85,99,0.2)' }, beginAtZero: true }
            },
            plugins: {
                legend: { labels: { color: '#9ca3af', font: { size: 11 }, usePointStyle: true } }
            }
        }
    });
}

async function setupAutoRefresh() {
    if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
    try {
        const res = await fetch('/api/settings');
        const s = await res.json();
        const interval = parseInt(s.auto_refresh_interval) || 0;
        if (interval > 0) {
            dashboardRefreshTimer = setInterval(() => loadDashboard(), interval * 1000);
        }
    } catch {}
}

// ============================================================
// Share Link
// ============================================================
async function loadShareStatus() {
    try {
        const res = await fetch(`/api/clients/${currentClientId}/share`);
        const data = await res.json();
        const textEl = document.getElementById('share-link-text');
        if (data.token) {
            textEl.textContent = 'Copy Share Link';
            document.getElementById('share-link-btn').classList.add('btn-share-active');
        } else {
            textEl.textContent = 'Share Dashboard';
            document.getElementById('share-link-btn').classList.remove('btn-share-active');
        }
    } catch {}
}

async function toggleShareLink() {
    try {
        const res = await fetch(`/api/clients/${currentClientId}/share`);
        const data = await res.json();

        if (data.token) {
            // Already shared — copy to clipboard or revoke
            const action = confirm(`Share link is active.\n\nClick OK to copy link.\nClick Cancel to revoke.`);
            if (action) {
                const url = `${window.location.origin}/shared/${data.token}`;
                await navigator.clipboard.writeText(url);
                toast('Share link copied!', 'success');
            } else {
                await fetch(`/api/clients/${currentClientId}/share`, { method: 'DELETE' });
                toast('Share link revoked', 'info');
                loadShareStatus();
            }
        } else {
            // Generate new share link
            const resp = await fetch(`/api/clients/${currentClientId}/share`, { method: 'POST' });
            const result = await resp.json();
            const url = `${window.location.origin}${result.url}`;
            await navigator.clipboard.writeText(url);
            toast('Share link created & copied!', 'success');
            loadShareStatus();
        }
    } catch (err) { toast('Failed: ' + err.message, 'error'); }
}

// Client Modal
function showClientModal() {
    editClientId = null;
    document.getElementById('client-modal-title').textContent = 'New Project';
    document.getElementById('client-save-btn').textContent = 'Create';
    document.getElementById('client-name-input').value = '';
    document.getElementById('client-modal').classList.add('show');
    setTimeout(() => document.getElementById('client-name-input').focus(), 100);
}

function hideClientModal() { document.getElementById('client-modal').classList.remove('show'); }

async function saveClient() {
    const name = document.getElementById('client-name-input').value.trim();
    if (!name) { toast('Project name is required', 'error'); return; }

    try {
        if (editClientId) {
            await fetch(`/api/clients/${editClientId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            toast('Project updated', 'success');
        } else {
            await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            toast('Project created', 'success');
        }
        hideClientModal();
        loadClients();
    } catch (err) { toast('Failed: ' + err.message, 'error'); }
}

// Export XLSX
function exportClientXLSX() {
    if (!currentClientId) return;
    window.location.href = `/api/clients/${currentClientId}/export`;
}

// ============================================================
// Campaign Detail
// ============================================================
async function viewCampaign(id) {
    currentCampaignId = id;
    showView('campaign-detail');
    try {
        const res = await fetch(`/api/campaigns/${id}`);
        const c = await res.json();
        const date = new Date(c.created_at + 'Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        document.getElementById('detail-campaign-name').textContent = c.name;
        document.getElementById('detail-campaign-date').textContent = `Created on ${date}`;
        document.getElementById('stat-targets').textContent = c.total_targets;
        document.getElementById('stat-sent').textContent = c.stats_sent;
        document.getElementById('stat-opened').textContent = c.stats_opened;
        document.getElementById('stat-clicked').textContent = c.stats_clicked;
        document.getElementById('stat-submitted').textContent = c.stats_submitted;

        const t = c.total_targets || 1;
        document.getElementById('bar-sent').style.width = `${(c.stats_sent / t) * 100}%`;
        document.getElementById('bar-opened').style.width = `${(c.stats_opened / t) * 100}%`;
        document.getElementById('bar-clicked').style.width = `${(c.stats_clicked / t) * 100}%`;
        document.getElementById('bar-submitted').style.width = `${(c.stats_submitted / t) * 100}%`;

        switchTab('summary');
    } catch (err) { toast('Failed to load campaign: ' + err.message, 'error'); }
}

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'summary') loadSummary();
    else if (tab === 'events') { eventsPage = 1; loadEvents(); }
    else if (tab === 'submitted') loadSubmitted();
}

// ============================================================
// Timeline (Per-User Expandable) with Filter & Pagination
// ============================================================
let timelineDebounce = null;
let tlAllUsers = [];        // full dataset from API
let tlFilteredUsers = [];   // after status filter
let tlCurrentFilter = 'all';
let tlPageSize = 25;
let tlCurrentPage = 1;

function debounceLoadTimeline() {
    clearTimeout(timelineDebounce);
    timelineDebounce = setTimeout(loadTimeline, 300);
}

function setTimelineFilter(status) {
    tlCurrentFilter = status;
    tlCurrentPage = 1;
    document.querySelectorAll('.tl-filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tl-filter-btn[data-status="${status}"]`)?.classList.add('active');
    applyTimelineFilter();
    renderTimelinePage();
}

function setTimelinePageSize() {
    tlPageSize = parseInt(document.getElementById('tl-page-size').value);
    tlCurrentPage = 1;
    renderTimelinePage();
}

function goTimelinePage(page) {
    tlCurrentPage = page;
    renderTimelinePage();
    // Scroll table to top
    document.querySelector('.table-wrapper-scroll')?.scrollTo(0, 0);
}

function applyTimelineFilter() {
    if (tlCurrentFilter === 'all') {
        tlFilteredUsers = tlAllUsers;
    } else {
        const statusMap = {
            'Email Sent': u => true, // all users were sent
            'Email Opened': u => ['Email Opened','Clicked Link','Submitted Data'].includes(u.status),
            'Clicked Link': u => ['Clicked Link','Submitted Data'].includes(u.status),
            'Submitted Data': u => u.status === 'Submitted Data',
        };
        const filterFn = statusMap[tlCurrentFilter] || (() => true);
        tlFilteredUsers = tlAllUsers.filter(filterFn);
    }
}

async function loadTimeline() {
    const search = document.getElementById('timeline-search')?.value || '';
    try {
        const res = await fetch(`/api/campaigns/${currentCampaignId}/timeline?search=${encodeURIComponent(search)}`);
        const data = await res.json();

        const tbody = document.getElementById('timeline-tbody');
        const countEl = document.getElementById('gp-timeline-count');

        if (data.error) {
            countEl.textContent = '';
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--danger)">${esc(data.error)}</td></tr>`;
            return;
        }

        // Store full dataset
        tlAllUsers = data.users;

        // Compute & render stats
        const sent = tlAllUsers.filter(u => u.status).length;
        const opened = tlAllUsers.filter(u => ['Email Opened','Clicked Link','Submitted Data'].includes(u.status)).length;
        const clicked = tlAllUsers.filter(u => ['Clicked Link','Submitted Data'].includes(u.status)).length;
        const submitted = tlAllUsers.filter(u => u.status === 'Submitted Data').length;

        document.getElementById('gp-timeline-stats').innerHTML = `
            <div class="gp-stat gp-stat-sent"><div class="gp-stat-val">${sent}</div><div class="gp-stat-label">Sent</div></div>
            <div class="gp-stat gp-stat-opened"><div class="gp-stat-val">${opened}</div><div class="gp-stat-label">Opened</div></div>
            <div class="gp-stat gp-stat-clicked"><div class="gp-stat-val">${clicked}</div><div class="gp-stat-label">Clicked</div></div>
            <div class="gp-stat gp-stat-submitted"><div class="gp-stat-val">${submitted}</div><div class="gp-stat-label">Submitted</div></div>
        `;

        countEl.textContent = `${data.users.length} of ${data.total} users (live)`;

        // Apply filter and render
        tlCurrentPage = 1;
        applyTimelineFilter();
        renderTimelinePage();
    } catch (err) { toast('Failed to load timeline: ' + err.message, 'error'); }
}

function renderTimelinePage() {
    const tbody = document.getElementById('timeline-tbody');
    const totalFiltered = tlFilteredUsers.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / tlPageSize));
    if (tlCurrentPage > totalPages) tlCurrentPage = totalPages;

    const start = (tlCurrentPage - 1) * tlPageSize;
    const pageUsers = tlFilteredUsers.slice(start, start + tlPageSize);

    tbody.innerHTML = pageUsers.length === 0
        ? `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">No users match this filter</td></tr>`
        : pageUsers.map((u, idx) => {
            const i = start + idx; // global index for toggle
            const statusClass = u.status.replace(/\s+/g, '-').toLowerCase();
            return `<tr class="tl-user-row" onclick="toggleTimelineRow(${i})">
                <td><span class="tl-toggle" id="tl-icon-${i}">▶</span></td>
                <td>${esc(u.firstName)}</td>
                <td>${esc(u.lastName)}</td>
                <td>${esc(u.email)}</td>
                <td>${esc(u.position || '')}</td>
                <td><span class="tl-status tl-${statusClass}">${u.status}</span></td>
            </tr>
            <tr class="tl-detail-row" id="tl-detail-${i}" style="display:none">
                <td colspan="6">
                    <div class="tl-events">
                        ${u.events.map(e => {
                            const evtClass = e.message.replace(/\s+/g, '-').toLowerCase();
                            const details = e.message === 'Email Sent' ? '' : `
                                <div class="tl-evt-details">
                                    <span>IP: <strong>${esc(e.ip || '-')}</strong></span>
                                    <span>OS: <strong>${esc(e.os)}</strong></span>
                                    <span>Browser: <strong>${esc(e.browser)}</strong></span>
                                </div>`;
                            const fieldsHtml = (e.submittedFields && Object.keys(e.submittedFields).length > 0) ? `
                                <div class="tl-submitted">
                                    <table class="tl-fields-table">
                                        <tr><th>Parameter</th><th>Value</th></tr>
                                        ${Object.entries(e.submittedFields).map(([k, v]) => `<tr><td class="tl-field-key">${esc(k)}</td><td class="tl-field-val">${esc(v || '-')}</td></tr>`).join('')}
                                    </table>
                                </div>` : '';
                            const countBadge = (e.submitCount && e.submitCount > 1) ? `<span class="tl-count-badge">×${e.submitCount}</span>` : '';
                            return `<div class="tl-event">
                                <div class="tl-evt-dot ${evtClass}"></div>
                                <div class="tl-evt-content">
                                    <div class="tl-evt-header">
                                        <strong class="tl-evt-type ${evtClass}">${e.message.toUpperCase()}</strong>
                                        ${countBadge}
                                        <span class="tl-evt-time">${esc(e.time)}</span>
                                    </div>
                                    ${details}
                                    ${fieldsHtml}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </td>
            </tr>`;
        }).join('');

    // Render pagination
    const pagEl = document.getElementById('tl-pagination');
    if (totalPages <= 1) { pagEl.innerHTML = ''; return; }

    let html = `<button class="tl-page-btn" onclick="goTimelinePage(${tlCurrentPage - 1})" ${tlCurrentPage === 1 ? 'disabled' : ''}>‹ Prev</button>`;
    html += `<span class="tl-page-info">${start + 1}–${Math.min(start + tlPageSize, totalFiltered)} of ${totalFiltered}</span>`;

    // Show limited page buttons
    const maxBtns = 5;
    let startPage = Math.max(1, tlCurrentPage - Math.floor(maxBtns / 2));
    let endPage = Math.min(totalPages, startPage + maxBtns - 1);
    if (endPage - startPage < maxBtns - 1) startPage = Math.max(1, endPage - maxBtns + 1);

    if (startPage > 1) html += `<button class="tl-page-btn" onclick="goTimelinePage(1)">1</button><span class="tl-page-info">…</span>`;
    for (let p = startPage; p <= endPage; p++) {
        html += `<button class="tl-page-btn ${p === tlCurrentPage ? 'active' : ''}" onclick="goTimelinePage(${p})">${p}</button>`;
    }
    if (endPage < totalPages) html += `<span class="tl-page-info">…</span><button class="tl-page-btn" onclick="goTimelinePage(${totalPages})">${totalPages}</button>`;

    html += `<button class="tl-page-btn" onclick="goTimelinePage(${tlCurrentPage + 1})" ${tlCurrentPage === totalPages ? 'disabled' : ''}">Next ›</button>`;
    pagEl.innerHTML = html;
}

function toggleTimelineRow(idx) {
    const detail = document.getElementById(`tl-detail-${idx}`);
    const icon = document.getElementById(`tl-icon-${idx}`);
    if (detail.style.display === 'none') {
        detail.style.display = 'table-row';
        icon.textContent = '▼';
    } else {
        detail.style.display = 'none';
        icon.textContent = '▶';
    }
}

// ============================================================
// Summary
// ============================================================
async function loadSummary() {
    try {
        const email = document.getElementById('summary-search').value;
        const params = email ? `?email=${encodeURIComponent(email)}` : '';
        const res = await fetch(`/api/campaigns/${currentCampaignId}/summary${params}`);
        currentSummaryData = await res.json();
        renderSummary();
    } catch (err) { toast('Failed to load summary', 'error'); }
}

function renderSummary() {
    document.getElementById('summary-tbody').innerHTML = currentSummaryData.map((s, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${esc(s.email)}</td>
            <td style="font-family:var(--font-mono);font-size:0.8rem">${esc(s.rid)}</td>
            <td><span class="badge ${s.email_sent === 'Yes' ? 'badge-yes' : 'badge-no'}">${s.email_sent}</span></td>
            <td><span class="badge ${s.email_opened === 'Yes' ? 'badge-yes' : 'badge-no'}">${s.email_opened}</span></td>
            <td><span class="badge ${s.clicked_link === 'Yes' ? 'badge-yes' : 'badge-no'}">${s.clicked_link}</span></td>
            <td><span class="badge ${s.submitted_data === 'Yes' ? 'badge-yes' : 'badge-no'}">${s.submitted_data}</span></td>
        </tr>`).join('');
}

function filterSummary() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadSummary, 300); }

// ============================================================
// Events
// ============================================================
async function loadEvents() {
    try {
        const email = document.getElementById('events-search').value;
        const message = document.getElementById('events-message-filter').value;
        const valid = document.getElementById('events-valid-filter').value;
        let params = `?page=${eventsPage}&limit=100`;
        if (email) params += `&email=${encodeURIComponent(email)}`;
        if (message) params += `&message=${encodeURIComponent(message)}`;
        if (valid) params += `&valid=${valid}`;

        const res = await fetch(`/api/campaigns/${currentCampaignId}/events${params}`);
        const data = await res.json();
        currentEventsData = data.events;

        document.getElementById('events-tbody').innerHTML = data.events.map((e, i) => {
            const sc = e.message.replace(/\s+/g, '-').toLowerCase();
            const bm = { 'email-sent': 'badge-sent', 'email-opened': 'badge-opened', 'clicked-link': 'badge-clicked', 'submitted-data': 'badge-submitted' };
            return `<tr style="${!e.is_valid ? 'opacity:0.5' : ''}">
                <td>${(eventsPage - 1) * 100 + i + 1}</td><td>${esc(e.email)}</td>
                <td style="font-family:var(--font-mono);font-size:0.8rem">${esc(e.rid)}</td>
                <td><span class="badge-status ${bm[sc] || ''}">${esc(e.message)}</span></td>
                <td style="font-size:0.8rem">${esc(e.time_formatted)}</td>
                <td style="font-family:var(--font-mono);font-size:0.8rem">${esc(e.ip_address)}</td>
                <td style="font-size:0.8rem" title="${esc(e.ip_details)}">${esc(e.ip_details?.substring(0, 40))}${(e.ip_details?.length || 0) > 40 ? '…' : ''}</td>
                <td><span class="badge ${e.is_valid ? 'badge-valid' : 'badge-invalid'}">${e.is_valid ? '✓' : '✗'}</span></td>
            </tr>`;
        }).join('');

        const pag = document.getElementById('events-pagination');
        if (data.totalPages > 1) {
            let html = `<button ${data.page <= 1 ? 'disabled' : ''} onclick="eventsPage=${data.page - 1};loadEvents()">← Prev</button>`;
            for (let p = Math.max(1, data.page - 2); p <= Math.min(data.totalPages, data.page + 2); p++) {
                html += `<button class="${p === data.page ? 'active' : ''}" onclick="eventsPage=${p};loadEvents()">${p}</button>`;
            }
            html += `<button ${data.page >= data.totalPages ? 'disabled' : ''} onclick="eventsPage=${data.page + 1};loadEvents()">Next →</button>`;
            pag.innerHTML = html;
        } else { pag.innerHTML = ''; }
    } catch (err) { toast('Failed to load events', 'error'); }
}

function debounceLoadEvents() { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => { eventsPage = 1; loadEvents(); }, 300); }

// ============================================================
// Submitted Data
// ============================================================
async function loadSubmitted() {
    try {
        const res = await fetch(`/api/campaigns/${currentCampaignId}/submitted`);
        const data = await res.json();
        document.getElementById('submitted-count').textContent = `${data.grouped.length} submissions`;
        const allFields = new Set();
        data.grouped.forEach(g => Object.keys(g.fields).forEach(k => allFields.add(k)));
        const fields = [...allFields];
        document.getElementById('submitted-thead-row').innerHTML = '<th>#</th><th>Email</th><th>RID</th><th>Time (WIB)</th>' + fields.map(f => `<th>${esc(f)}</th>`).join('');
        document.getElementById('submitted-tbody').innerHTML = data.grouped.map((g, i) => `<tr>
            <td>${i + 1}</td><td>${esc(g.email)}</td>
            <td style="font-family:var(--font-mono);font-size:0.8rem">${esc(g.rid)}</td>
            <td style="font-size:0.8rem">${esc(g.time)}</td>
            ${fields.map(f => `<td>${esc(g.fields[f] || '-')}</td>`).join('')}
        </tr>`).join('');
    } catch (err) { toast('Failed to load submitted data', 'error'); }
}

// ============================================================
// Bulk Upload
// ============================================================
let bulkPairs = {};

async function loadSavedToken() {
    try {
        const res = await fetch('/api/settings');
        const s = await res.json();
        if (s.ipinfo_token) { document.getElementById('ipinfo-token').value = s.ipinfo_token; }
    } catch {}
}

function handleBulkFiles(fileList) {
    bulkPairs = {};
    const files = [...fileList];

    for (const file of files) {
        const name = file.name;
        // Match: "Whatever - Events.csv" or "Whatever - Results.csv"
        let match = name.match(/^(.+?)\s*-\s*(Events|Results)\.csv$/i);
        if (!match) {
            match = name.match(/^(.+?)\s*-\s*(event[s]?\s*detail|campaign\s*results?)\.csv$/i);
            if (match) {
                const type = match[2].toLowerCase().includes('event') ? 'Events' : 'Results';
                match = [null, match[1], type];
            }
        }

        if (match) {
            const fullPrefix = match[1].trim();
            const type = match[2].toLowerCase().includes('event') ? 'events' : 'results';

            // Extract scenario name from "(XXX Scenario)" pattern
            const scenarioMatch = fullPrefix.match(/\(([^)]+?)\s+Scenario\)/i);
            const displayName = scenarioMatch ? scenarioMatch[1].trim() : fullPrefix;

            if (!bulkPairs[fullPrefix]) bulkPairs[fullPrefix] = { displayName };
            bulkPairs[fullPrefix][type] = file;
        }
    }

    renderPairs();
}

function renderPairs() {
    const container = document.getElementById('detected-pairs');
    const list = document.getElementById('pairs-list');
    const names = Object.keys(bulkPairs);

    if (names.length === 0) {
        container.style.display = 'none';
        document.getElementById('submit-btn').disabled = true;
        document.getElementById('drop-bulk').querySelector('.drop-text').textContent = 'Drop all CSV files here or click to browse';
        document.getElementById('drop-bulk').classList.remove('has-file');
        return;
    }

    container.style.display = 'block';
    document.getElementById('drop-bulk').classList.add('has-file');
    document.getElementById('drop-bulk').querySelector('.drop-text').textContent = `✅ ${Object.values(bulkPairs).reduce((a, p) => a + (p.events ? 1 : 0) + (p.results ? 1 : 0), 0)} files loaded`;

    let allComplete = true;
    list.innerHTML = names.map(name => {
        const pair = bulkPairs[name];
        const hasEvents = !!pair.events;
        const hasResults = !!pair.results;
        const complete = hasEvents && hasResults;
        const statusClass = pair.status === 'done' ? 'pair-done' : pair.status === 'error' ? 'pair-error' : complete ? 'pair-complete' : 'pair-missing';
        const statusIcon = pair.status === 'done' ? '✅' : pair.status === 'error' ? '❌' : pair.status === 'processing' ? '⏳' : complete ? '✓' : '⚠️';
        if (!complete && !pair.status) allComplete = false;

        return `<div class="pair-item ${statusClass}">
            <span class="pair-status">${statusIcon}</span>
            <span class="pair-name">${esc(pair.displayName || name)}</span>
            <span class="pair-files">${hasEvents ? '✓ Events' : '✗ Events'} | ${hasResults ? '✓ Results' : '✗ Results'}</span>
        </div>`;
    }).join('');

    document.getElementById('submit-btn').disabled = !allComplete;
}

async function submitBulkCampaigns() {
    const names = Object.keys(bulkPairs);
    if (names.length === 0) return;

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Processing...';
    document.getElementById('progress-container').style.display = 'block';

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const pair = bulkPairs[name];

        if (!pair.events || !pair.results) { pair.status = 'error'; renderPairs(); failed++; continue; }

        pair.status = 'processing';
        renderPairs();
        updateProgress(`Processing ${name}... (${i + 1}/${names.length})`, Math.round(((i) / names.length) * 100));

        const fd = new FormData();
        fd.append('clientId', currentClientId);
        fd.append('name', pair.displayName || name);
        fd.append('resultsFile', pair.results);
        fd.append('eventsFile', pair.events);
        fd.append('ipinfoToken', document.getElementById('ipinfo-token').value);
        fd.append('excludeOrgs', JSON.stringify(excludeOrgTags));

        try {
            const res = await fetch('/api/campaigns', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            pair.status = 'done';
            completed++;
        } catch (err) {
            pair.status = 'error';
            failed++;
            toast(`Failed: ${name} — ${err.message}`, 'error');
        }
        renderPairs();
    }

    updateProgress('Complete!', 100);
    toast(`Done! ${completed} campaigns processed${failed ? `, ${failed} failed` : ''}`, completed > 0 ? 'success' : 'error');

    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Process All Campaigns';
        document.getElementById('progress-container').style.display = 'none';
        showView('client-detail');
    }, 1500);
}

function updateProgress(label, pct) {
    document.getElementById('progress-label').textContent = label;
    document.getElementById('progress-pct').textContent = pct + '%';
    document.getElementById('progress-fill').style.width = pct + '%';
}

function handleFileSelect(input, zoneId) {
    const zone = document.getElementById(zoneId);
    if (input.files.length > 0) { zone.classList.add('has-file'); zone.querySelector('.drop-text').textContent = '✅ ' + input.files[0].name; }
}

// ============================================================
// Delete
// ============================================================
let deleteType = null, deleteId = null;

function showDeleteModal(type, id, name) {
    deleteType = type; deleteId = id;
    document.getElementById('delete-target-name').textContent = name;
    document.getElementById('delete-modal').classList.add('show');
}
function hideDeleteModal() { document.getElementById('delete-modal').classList.remove('show'); }

async function confirmDelete() {
    if (!deleteId) return;
    try {
        const url = deleteType === 'client' ? `/api/clients/${deleteId}` : `/api/campaigns/${deleteId}`;
        await fetch(url, { method: 'DELETE' });
        toast(`${deleteType === 'client' ? 'Client' : 'Campaign'} deleted`, 'success');
        hideDeleteModal();
        if (deleteType === 'client') loadClients();
        else loadClientCampaigns();
    } catch (err) { toast('Failed to delete', 'error'); }
}

// ============================================================
// Settings
// ============================================================
function showSettings() { document.getElementById('settings-modal').classList.add('show'); loadSettingsModal(); }
function hideSettings() { document.getElementById('settings-modal').classList.remove('show'); }

async function loadSettingsModal() {
    try {
        const res = await fetch('/api/settings');
        const s = await res.json();
        document.getElementById('settings-gophish-url').value = s.gophish_server_url || '';
        document.getElementById('settings-gophish-key').value = s.gophish_api_key || '';
        document.getElementById('settings-ipinfo-token').value = s.ipinfo_token || '';
        document.getElementById('settings-refresh-interval').value = s.auto_refresh_interval || '60';
        document.getElementById('settings-share-expiry').value = s.share_link_expiry_days || '0';
        document.getElementById('test-gophish-result').textContent = '';
    } catch {}
}

async function saveSettings() {
    try {
        const body = {
            gophish_server_url: document.getElementById('settings-gophish-url').value,
            gophish_api_key: document.getElementById('settings-gophish-key').value,
            ipinfo_token: document.getElementById('settings-ipinfo-token').value,
            auto_refresh_interval: document.getElementById('settings-refresh-interval').value,
            share_link_expiry_days: document.getElementById('settings-share-expiry').value,
        };
        await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        toast('Settings saved', 'success'); hideSettings();
    } catch (err) { toast('Failed to save', 'error'); }
}

async function testGoPhishConnection() {
    const btn = document.getElementById('test-gophish-btn');
    const result = document.getElementById('test-gophish-result');
    btn.disabled = true; result.textContent = 'Testing...'; result.className = 'test-result';

    // Save first so backend uses latest values
    const body = {
        gophish_server_url: document.getElementById('settings-gophish-url').value,
        gophish_api_key: document.getElementById('settings-gophish-key').value,
    };
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    try {
        const res = await fetch('/api/settings/test-gophish');
        const data = await res.json();
        if (data.success) {
            result.textContent = `✅ ${data.message}`;
            result.className = 'test-result success';
        } else {
            result.textContent = `❌ ${data.error}`;
            result.className = 'test-result error';
        }
    } catch (err) {
        result.textContent = `❌ ${err.message}`;
        result.className = 'test-result error';
    }
    btn.disabled = false;
}

// ============================================================
// GoPhish Sync
// ============================================================
let gpCampaignsList = [];

function showSyncModal() {
    document.getElementById('sync-modal').classList.add('show');
    loadGoPhishCampaigns();
}
function hideSyncModal() { document.getElementById('sync-modal').classList.remove('show'); }

async function loadGoPhishCampaigns() {
    const loading = document.getElementById('sync-loading');
    const error = document.getElementById('sync-error');
    const list = document.getElementById('sync-campaign-list');
    const syncList = document.getElementById('sync-list');

    loading.style.display = 'block'; error.style.display = 'none'; list.style.display = 'none';
    document.getElementById('sync-progress').style.display = 'none';

    try {
        const res = await fetch('/api/gophish/campaigns');
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to connect');
        }
        gpCampaignsList = await res.json();
        loading.style.display = 'none';

        if (gpCampaignsList.length === 0) {
            error.textContent = 'No campaigns found on GoPhish server';
            error.style.display = 'block';
            return;
        }

        document.getElementById('sync-count').textContent = `${gpCampaignsList.length} campaign(s) found`;
        syncList.innerHTML = gpCampaignsList.map(c => {
            const date = new Date(c.launch_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const statusClass = c.status.toLowerCase().includes('completed') ? 'completed' : 'in-progress';
            return `<label class="sync-item">
                <input type="checkbox" class="sync-checkbox" value="${c.id}" onchange="updateSyncBtn()">
                <div class="sync-item-info">
                    <div class="sync-item-name">${esc(c.displayName)}</div>
                    <div class="sync-item-full">${esc(c.name)}</div>
                </div>
                <span class="sync-item-status ${statusClass}">${c.status}</span>
                <span class="sync-item-meta">${date}</span>
            </label>`;
        }).join('');
        list.style.display = 'block';
        updateSyncBtn();
    } catch (err) {
        loading.style.display = 'none';
        error.textContent = `❌ ${err.message}. Configure GoPhish in Settings first.`;
        error.style.display = 'block';
    }
}

function toggleSyncAll() {
    const checked = document.getElementById('sync-select-all').checked;
    document.querySelectorAll('.sync-checkbox').forEach(cb => cb.checked = checked);
    updateSyncBtn();
}

function updateSyncBtn() {
    const selected = document.querySelectorAll('.sync-checkbox:checked').length;
    const btn = document.getElementById('sync-btn');
    btn.disabled = selected === 0;
    btn.textContent = selected > 0 ? `Sync ${selected} Campaign(s)` : 'Sync Selected';
}

async function syncSelectedCampaigns() {
    const selected = [...document.querySelectorAll('.sync-checkbox:checked')].map(cb => parseInt(cb.value));
    if (!selected.length) return;

    const btn = document.getElementById('sync-btn');
    btn.disabled = true;
    document.getElementById('sync-progress').style.display = 'block';

    try {
        const res = await fetch('/api/gophish/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: currentClientId, campaignIds: selected })
        });
        const data = await res.json();

        document.getElementById('sync-progress-fill').style.width = '100%';
        document.getElementById('sync-progress-pct').textContent = '100%';

        if (data.success) {
            const ok = data.results.filter(r => r.success).length;
            const fail = data.results.filter(r => !r.success).length;
            document.getElementById('sync-progress-label').textContent = `Synced ${ok} campaign(s)${fail > 0 ? `, ${fail} failed` : ''}`;
            toast(`Synced ${ok} campaign(s) from GoPhish`, 'success');
            setTimeout(() => { hideSyncModal(); showView('client-detail'); }, 1500);
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        toast(`Sync failed: ${err.message}`, 'error');
        btn.disabled = false;
    }
}

// ============================================================
// Export
// ============================================================
function exportCampaignZip() { if (currentCampaignId) window.location.href = `/api/campaigns/${currentCampaignId}/export`; }

// ============================================================
// Copy to Clipboard
// ============================================================
function copySummaryAll() {
    if (!currentSummaryData.length) { toast('No data', 'error'); return; }
    const h = 'RID\tEmail\tSent\tOpened\tClicked\tSubmitted';
    const r = currentSummaryData.map(s => `${s.rid}\t${s.email}\t${s.email_sent}\t${s.email_opened}\t${s.clicked_link}\t${s.submitted_data}`);
    navigator.clipboard.writeText([h, ...r].join('\n')).then(() => toast(`Copied ${r.length} rows`, 'success'));
}

function copySummaryColumn() {
    const cols = ['email', 'rid', 'email_sent', 'email_opened', 'clicked_link', 'submitted_data'];
    const col = prompt('Column:\n1.Email 2.RID 3.Sent 4.Opened 5.Clicked 6.Submitted');
    const idx = parseInt(col) - 1;
    if (isNaN(idx) || idx < 0 || idx >= cols.length) return;
    navigator.clipboard.writeText(currentSummaryData.map(s => s[cols[idx]]).join('\n')).then(() => toast('Copied', 'success'));
}

function copyEventsAll() {
    if (!currentEventsData.length) { toast('No data', 'error'); return; }
    const h = 'Email\tRID\tStatus\tTime\tIP\tIP Details\tValid';
    const r = currentEventsData.map(e => `${e.email}\t${e.rid}\t${e.message}\t${e.time_formatted}\t${e.ip_address}\t${e.ip_details}\t${e.is_valid ? 'Yes' : 'No'}`);
    navigator.clipboard.writeText([h, ...r].join('\n')).then(() => toast(`Copied ${r.length} rows`, 'success'));
}

function copyEventsColumn() {
    const cols = ['email', 'rid', 'message', 'time_formatted', 'ip_address', 'ip_details'];
    const col = prompt('Column:\n1.Email 2.RID 3.Status 4.Time 5.IP 6.Details');
    const idx = parseInt(col) - 1;
    if (isNaN(idx) || idx < 0 || idx >= cols.length) return;
    navigator.clipboard.writeText(currentEventsData.map(e => e[cols[idx]]).join('\n')).then(() => toast('Copied', 'success'));
}

function copySubmittedData() {
    const table = document.getElementById('submitted-table');
    const headerCells = [...table.querySelectorAll('thead th')];
    const header = headerCells.filter((_, i) => i !== 0).map(th => th.textContent).join('\t');
    const rows = [...table.querySelectorAll('tbody tr')].map(tr => {
        return [...tr.querySelectorAll('td')].filter((_, i) => i !== 0).map(td => td.textContent).join('\t');
    });
    navigator.clipboard.writeText([header, ...rows].join('\n')).then(() => toast(`Copied ${rows.length} rows`, 'success'));
}

// ============================================================
// Utils & Init
// ============================================================
function esc(str) { if (!str) return '-'; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`; el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

function closeModal(e) { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('show'); }

document.addEventListener('DOMContentLoaded', () => {
    // Bulk drop zone
    const bulkZone = document.getElementById('drop-bulk');
    if (bulkZone) {
        bulkZone.addEventListener('dragover', e => { e.preventDefault(); bulkZone.classList.add('dragover'); });
        bulkZone.addEventListener('dragleave', () => bulkZone.classList.remove('dragover'));
        bulkZone.addEventListener('drop', e => {
            e.preventDefault(); bulkZone.classList.remove('dragover');
            handleBulkFiles(e.dataTransfer.files);
        });
    }

    // Tags
    const ti = document.getElementById('exclude-org-input');
    if (ti) ti.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault(); const v = ti.value.trim();
            if (v && !excludeOrgTags.includes(v)) { excludeOrgTags.push(v); renderTags(); }
            ti.value = '';
        }
    });

    showView('clients');
});

function renderTags() {
    document.getElementById('tags-list').innerHTML = excludeOrgTags.map((t, i) =>
        `<span class="tag">${esc(t)}<button class="tag-remove" onclick="removeTag(${i})">&times;</button></span>`
    ).join('');
}
function removeTag(i) { excludeOrgTags.splice(i, 1); renderTags(); }

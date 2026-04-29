// In-memory cache for IP lookups to avoid duplicate API calls
const ipCache = new Map();
let handlerToken = null;

/**
 * Initialize the IPinfo handler with a token.
 */
function initHandler(token) {
    if (!token) {
        console.warn('[IPinfo] No token provided, IP lookups will be limited');
        handlerToken = null;
        return;
    }
    handlerToken = token;
    console.log('[IPinfo] Token configured');
}

/**
 * Get IP details from IPinfo API with caching.
 * Returns { details: string, isValid: boolean }
 */
async function getIpDetails(ipAddress, excludeOrgs = []) {
    if (!ipAddress || ipAddress === '-') {
        return { details: '-', isValid: true };
    }

    // Check cache first
    const cacheKey = `${ipAddress}:${excludeOrgs.join(',')}`;
    if (ipCache.has(cacheKey)) {
        return ipCache.get(cacheKey);
    }

    if (!handlerToken) {
        const result = { details: 'No IPinfo token configured', isValid: true };
        ipCache.set(cacheKey, result);
        return result;
    }

    try {
        const url = `https://ipinfo.io/${ipAddress}/json?token=${handlerToken}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const info = await response.json();
        const city = info.city || 'Unknown';
        const country = info.country || 'Unknown';
        const org = info.org || 'Unknown';

        const orgDetails = `${city}, ${country} - ${org}`;
        const isValid = !excludeOrgs.some(excl =>
            org.toLowerCase().includes(excl.toLowerCase())
        );

        const result = { details: orgDetails, isValid };
        ipCache.set(cacheKey, result);

        console.log(`[IPinfo] ${ipAddress} → ${isValid ? 'valid' : 'EXCLUDED'} (${org})`);
        return result;

    } catch (err) {
        console.error(`[IPinfo] Error for ${ipAddress}:`, err.message);
        const result = { details: `Lookup failed - ${err.message}`, isValid: true };
        ipCache.set(cacheKey, result);
        return result;
    }
}

function clearCache() {
    ipCache.clear();
}

module.exports = { initHandler, getIpDetails, clearCache };

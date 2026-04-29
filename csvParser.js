const Papa = require('papaparse');
const fs = require('fs');

function parseCSV(filePath, requiredColumns = []) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    const result = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
    });

    if (requiredColumns.length > 0 && result.data.length > 0) {
        const headers = Object.keys(result.data[0]);
        const missing = requiredColumns.filter(col => !headers.includes(col));
        if (missing.length > 0) {
            throw new Error(`Missing required columns: ${missing.join(', ')}. Found: ${headers.join(', ')}`);
        }
    }

    return result.data;
}

function parseResultsCSV(filePath) {
    return parseCSV(filePath, ['id', 'email']);
}

function parseEventsCSV(filePath) {
    return parseCSV(filePath, ['email', 'time', 'message', 'details']);
}

module.exports = { parseCSV, parseResultsCSV, parseEventsCSV };

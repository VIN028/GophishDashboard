const ExcelJS = require('exceljs');

const PURPLE = 'FF6A1B9A';
const PURPLE_LIGHT = 'FF9C27B0';
const WHITE = 'FFFFFFFF';
const GREEN = 'FF4CAF50';
const YELLOW = 'FFFFC107';
const ORANGE = 'FFFF9800';
const RED = 'FFF44336';
const GRAY_LIGHT = 'FFF5F5F5';
const GRAY_BORDER = 'FFE0E0E0';

function applyHeaderStyle(row) {
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            bottom: { style: 'thin', color: { argb: GRAY_BORDER } }
        };
    });
}

function applyCellBorder(cell) {
    cell.border = {
        bottom: { style: 'hair', color: { argb: GRAY_BORDER } }
    };
}

function autoWidth(sheet) {
    sheet.columns.forEach(col => {
        let maxLen = 10;
        col.eachCell({ includeEmpty: false }, cell => {
            const len = cell.value ? String(cell.value).length : 0;
            if (len > maxLen) maxLen = len;
        });
        col.width = Math.min(maxLen + 4, 50);
    });
}

/**
 * Generate XLSX for a client with all campaigns.
 * @param {Object} db - Database instance
 * @param {number} clientId - Client ID
 * @returns {Promise<Buffer>} XLSX buffer
 */
async function generateClientXLSX(db, clientId) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    const campaigns = db.prepare('SELECT * FROM campaigns WHERE client_id = ? ORDER BY created_at ASC').all(clientId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GoPhish Analyzer';
    workbook.created = new Date();

    for (const campaign of campaigns) {
        // ============================================================
        // SHEET 1: Summary
        // ============================================================
        const summaryData = db.prepare('SELECT * FROM summary WHERE campaign_id = ? ORDER BY id').all(campaign.id);
        const sheetName = makeSheetName(workbook, campaign.name, 'Summary');
        const ws = workbook.addWorksheet(sheetName);


        // Row 1: Title
        ws.getCell('H1').value = 'PHISHING SUMMARY';
        ws.getCell('H1').font = { bold: true, size: 12, color: { argb: WHITE } };
        ws.getCell('H1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
        ws.getCell('I1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
        ws.getCell('J1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
        ws.mergeCells('H1:J1');
        ws.getCell('H1').alignment = { horizontal: 'center' };

        // Row 2: Headers
        ws.getCell('H2').value = 'Status';
        ws.getCell('I2').value = 'Total';
        ws.getCell('J2').value = '%';
        ['H2', 'I2', 'J2'].forEach(c => {
            ws.getCell(c).font = { bold: true, size: 10, color: { argb: WHITE } };
            ws.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_LIGHT } };
            ws.getCell(c).alignment = { horizontal: 'center' };
        });

        // Stats rows — use Excel formulas so editing data auto-updates summary
        // Data will start at row 10 (dataStartRow+1). Columns: D=Sent, E=Read, F=Clicked Link, G=Submitted Data
        const dataStartRow = 9;
        const firstDataRow = dataStartRow + 1; // row 10
        const lastDataRow = dataStartRow + summaryData.length; // row 9 + N

        const statsRows = [
            { label: 'Total Email Target', formula: `COUNTA(C${firstDataRow}:C${lastDataRow})`, pctFormula: null, color: GREEN },
            { label: 'Email Sent', formula: `COUNTIF(D${firstDataRow}:D${lastDataRow},"Yes")`, pctFormula: `IF(I3=0,0,I4/I3*100)`, color: GREEN },
            { label: 'Email Opened', formula: `COUNTIF(E${firstDataRow}:E${lastDataRow},"Yes")`, pctFormula: `IF(I3=0,0,I5/I3*100)`, color: YELLOW },
            { label: 'Clicked Link', formula: `COUNTIF(F${firstDataRow}:F${lastDataRow},"Yes")`, pctFormula: `IF(I3=0,0,I6/I3*100)`, color: ORANGE },
            { label: 'Submitted Data', formula: `COUNTIF(G${firstDataRow}:G${lastDataRow},"Yes")`, pctFormula: `IF(I3=0,0,I7/I3*100)`, color: RED },
        ];

        statsRows.forEach((stat, i) => {
            const row = i + 3;
            ws.getCell(`H${row}`).value = stat.label;
            ws.getCell(`H${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stat.color } };
            ws.getCell(`H${row}`).font = { bold: true, color: { argb: WHITE }, size: 10 };
            ws.getCell(`I${row}`).value = { formula: stat.formula };
            ws.getCell(`I${row}`).alignment = { horizontal: 'center' };
            ws.getCell(`I${row}`).font = { bold: true };
            if (stat.pctFormula) {
                ws.getCell(`J${row}`).value = { formula: stat.pctFormula };
                ws.getCell(`J${row}`).numFmt = '0.00';
            }
            ws.getCell(`J${row}`).alignment = { horizontal: 'center' };
        });

        // Data table header (row 9)
        const summaryHeaders = ['No', 'ID', 'Email', 'Sent', 'Read', 'Clicked Link', 'Submitted Data', 'Note'];
        const headerRow = ws.getRow(dataStartRow);
        summaryHeaders.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
        applyHeaderStyle(headerRow);

        // Data rows
        summaryData.forEach((s, i) => {
            const row = ws.getRow(dataStartRow + 1 + i);
            row.getCell(1).value = i + 1;
            row.getCell(2).value = s.rid || '-';
            row.getCell(3).value = s.email || '-';
            row.getCell(4).value = s.email_sent;
            row.getCell(5).value = s.email_opened;
            row.getCell(6).value = s.clicked_link;
            row.getCell(7).value = s.submitted_data;
            row.getCell(8).value = '';

            // Color-code Yes/No
            for (let c = 4; c <= 7; c++) {
                const cell = row.getCell(c);
                cell.alignment = { horizontal: 'center' };
                if (cell.value === 'Yes') {
                    cell.font = { color: { argb: 'FF2E7D32' }, bold: true };
                }
                applyCellBorder(cell);
            }

            // Zebra striping
            if (i % 2 === 1) {
                for (let c = 1; c <= 8; c++) {
                    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_LIGHT } };
                }
            }
        });

        // Freeze panes & auto width
        ws.views = [{ state: 'frozen', ySplit: dataStartRow }];
        autoWidth(ws);
        ws.getColumn(8).width = 20; // Note column

        // ============================================================
        // SHEET 2: Data Inputted
        // ============================================================
        const submitted = db.prepare('SELECT * FROM submitted_data WHERE campaign_id = ? ORDER BY email, id').all(campaign.id);

        if (submitted.length > 0 || true) { // Always create the sheet
            const dataSheetName = makeSheetName(workbook, campaign.name, 'Data');
            const ds = workbook.addWorksheet(dataSheetName);

            // Group submitted data by email
            const grouped = {};
            const allFields = [];
            for (const row of submitted) {
                if (!grouped[row.email]) {
                    grouped[row.email] = { email: row.email, rid: row.rid, time: row.time_formatted, fields: {} };
                }
                grouped[row.email].fields[row.field_name] = row.field_value;
                if (!allFields.includes(row.field_name)) allFields.push(row.field_name);
            }
            const groupedList = Object.values(grouped);

            // Summary box (top-right)
            ds.getCell('H1').value = 'SUMMARY OF DATA INPUTTED';
            ds.getCell('H1').font = { bold: true, size: 11, color: { argb: WHITE } };
            ds.getCell('H1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
            ds.getCell('I1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
            ds.mergeCells('H1:I1');
            ds.getCell('H1').alignment = { horizontal: 'center' };

            ds.getCell('H2').value = 'Status';
            ds.getCell('I2').value = 'Total';
            ['H2', 'I2'].forEach(c => {
                ds.getCell(c).font = { bold: true, color: { argb: WHITE }, size: 10 };
                ds.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_LIGHT } };
                ds.getCell(c).alignment = { horizontal: 'center' };
            });

            // Data table starts at row 7, RID is column B
            const dsStartRow = 6;
            const dsFirstDataRow = dsStartRow + 1; // row 7
            const dsLastDataRow = dsStartRow + groupedList.length; // row 6 + N

            ds.getCell('H3').value = 'Total Unique User';
            // Count unique RIDs: SUMPRODUCT(1/COUNTIF(B7:B{last},B7:B{last}))
            ds.getCell('I3').value = { formula: `SUMPRODUCT(1/COUNTIF(B${dsFirstDataRow}:B${dsLastDataRow},B${dsFirstDataRow}:B${dsLastDataRow}))` };
            ds.getCell('H4').value = 'Total Data Inputted';
            ds.getCell('I4').value = { formula: `COUNTA(A${dsFirstDataRow}:A${dsLastDataRow})` };
            ['H3', 'H4'].forEach(c => {
                ds.getCell(c).font = { bold: true, size: 10 };
            });
            ['I3', 'I4'].forEach(c => {
                ds.getCell(c).alignment = { horizontal: 'center' };
                ds.getCell(c).font = { bold: true };
            });

            // Data table
            const dsHeaders = ['No', 'RID', 'Email', 'Time (WIB)', ...allFields];
            const dsHeaderRow = ds.getRow(dsStartRow);
            dsHeaders.forEach((h, i) => { dsHeaderRow.getCell(i + 1).value = h; });
            applyHeaderStyle(dsHeaderRow);

            groupedList.forEach((g, i) => {
                const row = ds.getRow(dsStartRow + 1 + i);
                row.getCell(1).value = i + 1;
                row.getCell(2).value = g.rid || '-';
                row.getCell(3).value = g.email || '-';
                row.getCell(4).value = g.time || '-';
                allFields.forEach((f, fi) => {
                    row.getCell(5 + fi).value = g.fields[f] || '';
                });

                // Zebra
                if (i % 2 === 1) {
                    for (let c = 1; c <= dsHeaders.length; c++) {
                        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_LIGHT } };
                    }
                }
            });

            ds.views = [{ state: 'frozen', ySplit: dsStartRow }];
            autoWidth(ds);
        }
    }

    return workbook.xlsx.writeBuffer();
}

function makeSheetName(workbook, campaignName, suffix) {
    // Excel max 31 chars. Clean special chars first.
    const clean = campaignName.replace(/[\\/*?:\[\]]/g, '').trim();
    const maxNameLen = 31 - suffix.length - 1; // -1 for space
    const base = clean.substring(0, maxNameLen);
    let name = `${base} ${suffix}`.substring(0, 31);

    // Deduplicate if name already exists
    let counter = 2;
    let finalName = name;
    while (workbook.getWorksheet(finalName)) {
        const numbered = `${name.substring(0, 28)} ${counter}`;
        finalName = numbered.substring(0, 31);
        counter++;
    }
    return finalName;
}

module.exports = { generateClientXLSX };

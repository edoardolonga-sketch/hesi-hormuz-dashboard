import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/cftc-latest.json",
  import.meta.url
);

const SOURCE_ID = "cftc_cot";
const MARKET_CODE = "067651";

const CFTC_URL =
  "https://www.cftc.gov/dea/futures/petroleum_sf.htm";

function cleanText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const number = Number(
    value.replace(/,/g, "").trim()
  );

  if (!Number.isFinite(number)) {
    throw new Error(
      `Invalid CFTC numeric value: ${value}`
    );
  }

  return number;
}

async function main() {
  const executionTimestamp =
    new Date().toISOString();

  const response = await fetch(CFTC_URL, {
    headers: {
      "User-Agent": "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `CFTC request failed: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const text = cleanText(html);

  /*
   * Locate WTI-PHYSICAL using the unique CFTC market code.
   * Then isolate only that market section.
   */
  const codeMarker = `CFTC Code #${MARKET_CODE}`;
  const codeIndex = text.indexOf(codeMarker);

  if (codeIndex === -1) {
    throw new Error(
      `CFTC market code ${MARKET_CODE} not found.`
    );
  }

  const sectionStart = Math.max(
    0,
    text.lastIndexOf(
      "WTI-PHYSICAL",
      codeIndex
    )
  );

  const nextReportIndex = text.indexOf(
    "Disaggregated Commitments of Traders",
    codeIndex + codeMarker.length
  );

  const sectionEnd =
    nextReportIndex === -1
      ? text.length
      : nextReportIndex;

  const section = text.slice(
    sectionStart,
    sectionEnd
  );

  if (
    !section.includes("WTI-PHYSICAL") ||
    !section.includes(codeMarker)
  ) {
    throw new Error(
      "WTI-PHYSICAL CFTC section could not be isolated safely."
    );
  }

  /*
   * CFTC column order:
   *
   * Producer Long
   * Producer Short
   * Swap Long
   * Swap Short
   * Swap Spreading
   * Managed Money Long
   * Managed Money Short
   * Managed Money Spreading
   * Other Long
   * Other Short
   * Other Spreading
   */
  const positionsMatch = section.match(
    /Positions\s*:\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/
  );

  if (!positionsMatch) {
    throw new Error(
      "WTI-PHYSICAL position row could not be parsed safely."
    );
  }

  const reportDateMatch = text.match(
    /Positions as of\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
  );

  if (!reportDateMatch) {
    throw new Error(
      "CFTC report date could not be parsed safely."
    );
  }

  const reportDate = new Date(
    `${reportDateMatch[1]} 00:00:00 UTC`
  );

  if (Number.isNaN(reportDate.getTime())) {
    throw new Error(
      "Invalid CFTC report date."
    );
  }

  const observationDate =
    reportDate.toISOString().slice(0, 10);

  const managedMoneyLong =
    parseNumber(positionsMatch[6]);

  const managedMoneyShort =
    parseNumber(positionsMatch[7]);

  const managedMoneySpreading =
    parseNumber(positionsMatch[8]);

  const managedMoneyNet =
    managedMoneyLong - managedMoneyShort;

  const output = {
    schemaVersion: "1.0",

    sourceId: SOURCE_ID,
    seriesId:
      "CFTC_WTI_PHYSICAL_MANAGED_MONEY",

    marketCode: MARKET_CODE,

    executionTimestamp,

    observationDate,

    availableAt:
      executionTimestamp,

    managedMoneyLong,
    managedMoneyShort,
    managedMoneySpreading,
    managedMoneyNet,

    unit: "contracts",
    frequency: "weekly",

    source:
      "U.S. Commodity Futures Trading Commission",

    sourceUrl: CFTC_URL,

    fetchStatus: "SUCCESS",
    responseValidated: true,

    availableAtRule:
      "FIRST_OBSERVED_BY_PIPELINE"
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "CFTC WTI positioning fetch"
  );
  console.log(
    "--------------------------"
  );
  console.log(
    `Market code: ${MARKET_CODE}`
  );
  console.log(
    `Observation date: ${observationDate}`
  );
  console.log(
    `Managed Money Long: ${managedMoneyLong}`
  );
  console.log(
    `Managed Money Short: ${managedMoneyShort}`
  );
  console.log(
    `Managed Money Spreading: ${managedMoneySpreading}`
  );
  console.log(
    `Managed Money Net: ${managedMoneyNet}`
  );
  console.log(
    `AvailableAt: ${executionTimestamp}`
  );
  console.log(
    "AvailableAt protection: ENABLED"
  );
}

main().catch((error) => {
  console.error("CFTC fetch failed:");
  console.error(error);
  process.exit(1);
});

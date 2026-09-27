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
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
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
   * Find the exact WTI-PHYSICAL market using
   * its unique CFTC market code.
   */
  const codeMarker =
    `CFTC Code #${MARKET_CODE}`;

  const codeIndex =
    text.indexOf(codeMarker);

  if (codeIndex === -1) {
    throw new Error(
      `CFTC market code ${MARKET_CODE} not found.`
    );
  }

  /*
   * Locate the WTI-PHYSICAL heading immediately
   * before market code 067651.
   */
  const sectionStart =
    text.lastIndexOf(
      "WTI-PHYSICAL",
      codeIndex
    );

  if (sectionStart === -1) {
    throw new Error(
      "WTI-PHYSICAL heading not found."
    );
  }

  /*
   * Keep a limited section after the market code.
   * This prevents accidentally parsing another
   * petroleum contract farther down the page.
   */
  const section = text.slice(
    sectionStart,
    Math.min(text.length, codeIndex + 2500)
  );

  if (
    !section.includes(
      "WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE"
    ) ||
    !section.includes(codeMarker)
  ) {
    throw new Error(
      "WTI-PHYSICAL CFTC section validation failed."
    );
  }

  /*
   * Actual CFTC row observed:
   *
   * Positions : :
   * 607,458 304,558 111,924 584,713 128,007
   * 223,190 121,362 276,269
   * 137,620 98,342 280,997
   *
   * Column order:
   *
   * 1  Producer/Merchant Long
   * 2  Producer/Merchant Short
   * 3  Swap Dealers Long
   * 4  Swap Dealers Short
   * 5  Swap Dealers Spreading
   * 6  Managed Money Long
   * 7  Managed Money Short
   * 8  Managed Money Spreading
   * 9  Other Reportables Long
   * 10 Other Reportables Short
   * 11 Other Reportables Spreading
   */
  const positionsMatch = section.match(
    /Positions\s*:\s*:\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/
  );

  if (!positionsMatch) {
    throw new Error(
      "WTI-PHYSICAL position row could not be parsed safely."
    );
  }

  /*
   * The report date is contained in the
   * WTI-PHYSICAL section itself.
   */
  const reportDateMatch = section.match(
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

  /*
   * Basic sanity checks.
   */
  if (
    managedMoneyLong < 0 ||
    managedMoneyShort < 0 ||
    managedMoneySpreading < 0
  ) {
    throw new Error(
      "Invalid negative CFTC positioning value."
    );
  }

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

    value:
      managedMoneyNet,

    unit:
      "contracts",

    frequency:
      "weekly",

    source:
      "U.S. Commodity Futures Trading Commission",

    sourceUrl:
      CFTC_URL,

    fetchStatus:
      "SUCCESS",

    responseValidated:
      true,

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
  console.error(
    "CFTC fetch failed:"
  );
  console.error(error);
  process.exit(1);
});

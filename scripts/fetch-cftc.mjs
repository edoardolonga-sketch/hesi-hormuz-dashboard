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
  return Number(value.replace(/,/g, ""));
}

async function main() {
  const executionTimestamp = new Date().toISOString();

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

  const sectionMatch = text.match(
    /WTI-PHYSICAL\s*-\s*NEW YORK MERCANTILE EXCHANGE[\s\S]*?CFTC Code #067651[\s\S]*?Positions\s*:\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/
  );

  if (!sectionMatch) {
    throw new Error(
      "WTI Physical CFTC positions could not be parsed safely."
    );
  }

  const reportDateMatch = text.match(
    /Positions as of ([A-Za-z]+ \d{1,2}, \d{4})/
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
    throw new Error("Invalid CFTC report date.");
  }

  const observationDate =
    reportDate.toISOString().slice(0, 10);

  const managedMoneyLong =
    parseNumber(sectionMatch[6]);

  const managedMoneyShort =
    parseNumber(sectionMatch[7]);

  const managedMoneySpreading =
    parseNumber(sectionMatch[8]);

  const managedMoneyNet =
    managedMoneyLong - managedMoneyShort;

  const output = {
    schemaVersion: "1.0",

    sourceId: SOURCE_ID,
    seriesId: "CFTC_WTI_PHYSICAL_MANAGED_MONEY",

    marketCode: MARKET_CODE,

    executionTimestamp,

    observationDate,

    availableAt: executionTimestamp,

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

  console.log("CFTC WTI positioning fetch");
  console.log("--------------------------");
  console.log(`Market code: ${MARKET_CODE}`);
  console.log(`Observation date: ${observationDate}`);
  console.log(
    `Managed Money Long: ${managedMoneyLong}`
  );
  console.log(
    `Managed Money Short: ${managedMoneyShort}`
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

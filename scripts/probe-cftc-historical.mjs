import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/cftc-historical-probe.json",
  import.meta.url
);

const MARKET_CODE = "067651";

const TEST_YEAR = 2025;

const ARCHIVE_URL =
  `https://www.cftc.gov/files/dea/history/deacot${TEST_YEAR}.zip`;

const HISTORICAL_INDEX_URL =
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm";

const RELEASE_SCHEDULE_URL =
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm";

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${label} request failed: ` +
      `${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

async function fetchBytes(url, label) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${label} request failed: ` +
      `${response.status} ${response.statusText}`
    );
  }

  const buffer =
    await response.arrayBuffer();

  return Buffer.from(buffer);
}

function containsMarketCode(text) {
  return (
    text.includes(MARKET_CODE) ||
    text.includes(`Code-${MARKET_CODE}`) ||
    text.includes(`CFTC Code #${MARKET_CODE}`)
  );
}

async function main() {
  const executionTimestamp =
    new Date().toISOString();

  /*
   * 1. Verify that the official Historical
   *    Compressed page is reachable and describes
   *    Disaggregated Futures Only history.
   */
  const historicalIndex =
    await fetchText(
      HISTORICAL_INDEX_URL,
      "CFTC historical index"
    );

  const historicalIndexValidated =
    historicalIndex.includes(
      "Disaggregated Futures Only"
    ) &&
    historicalIndex.includes(
      String(TEST_YEAR)
    );

  if (!historicalIndexValidated) {
    throw new Error(
      "CFTC historical index validation failed."
    );
  }

  /*
   * 2. Verify the official release-schedule page.
   *
   * We intentionally DO NOT use this to assign
   * historical AvailableAt values.
   */
  const releaseSchedule =
    await fetchText(
      RELEASE_SCHEDULE_URL,
      "CFTC release schedule"
    );

  const releaseScheduleValidated =
    releaseSchedule.includes(
      "3:30"
    ) &&
    releaseSchedule.toLowerCase()
      .includes("eastern");

  if (!releaseScheduleValidated) {
    throw new Error(
      "CFTC release schedule validation failed."
    );
  }

  /*
   * 3. Download one official historical archive
   *    as a connectivity/format probe.
   *
   * This probe deliberately does not yet extract
   * or admit observations.
   */
  const archiveBytes =
    await fetchBytes(
      ARCHIVE_URL,
      "CFTC historical archive"
    );

  if (archiveBytes.length === 0) {
    throw new Error(
      "CFTC historical archive is empty."
    );
  }

  /*
   * ZIP signature:
   * 50 4B 03 04
   */
  const zipSignatureValid =
    archiveBytes.length >= 4 &&
    archiveBytes[0] === 0x50 &&
    archiveBytes[1] === 0x4b &&
    archiveBytes[2] === 0x03 &&
    archiveBytes[3] === 0x04;

  if (!zipSignatureValid) {
    throw new Error(
      "Downloaded CFTC archive is not a valid ZIP payload."
    );
  }

  /*
   * A binary ZIP cannot safely be searched for
   * market rows without extraction.
   *
   * Therefore market-code extraction remains
   * explicitly pending rather than pretending
   * that the archive has already been parsed.
   */
  const output = {
    schemaVersion: "1.0",

    status:
      "CFTC_HISTORICAL_AVAILABILITY_PROBE_NOT_ADMITTED",

    executionTimestamp,

    targetSeries: {
      sourceId: "cftc_cot",
      seriesId:
        "CFTC_WTI_PHYSICAL_MANAGED_MONEY",
      marketCode: MARKET_CODE,
      marketName: "WTI-PHYSICAL",
      reportType:
        "Disaggregated Futures Only",
      metric:
        "Managed Money Long minus Managed Money Short"
    },

    officialHistoricalSource: {
      provider:
        "U.S. Commodity Futures Trading Commission",
      indexUrl:
        HISTORICAL_INDEX_URL,
      testYear:
        TEST_YEAR,
      archiveUrl:
        ARCHIVE_URL,
      indexValidated:
        historicalIndexValidated,
      archiveDownloaded: true,
      archiveByteLength:
        archiveBytes.length,
      zipSignatureValid
    },

    availabilityEvidence: {
      releaseScheduleUrl:
        RELEASE_SCHEDULE_URL,

      releaseSchedulePageValidated:
        releaseScheduleValidated,

      normalPublicationRule:
        "COT reports are generally released Friday at 3:30 p.m. Eastern Time using data from the preceding Tuesday.",

      holidayDelayPossible: true,

      completeHistoricalReleaseDateListEstablished:
        false,

      exactHistoricalAvailableAtEstablished:
        false,

      syntheticAvailableAtAssigned:
        false,

      observationDatePlusThreeDaysAssumed:
        false,

      researchConclusion:
        "Historical CFTC values are available from official archives, but this probe does not establish an exact AvailableAt for every historical observation."
    },

    extractionStatus: {
      archiveExtractionPerformed: false,
      marketCodeSearchPerformed: false,
      marketCodeFound: null,
      observationsExtracted: 0
    },

    safeguards: {
      historicalStoreModified: false,
      historicalDatasetModified: false,
      pointInTimeDatasetModified: false,
      calibrationPerformed: false,
      modelWeightsModified: false,
      officialHesiModified: false
    },

    nextResearchQuestion:
      "Determine a defensible historical AvailableAt methodology before any CFTC historical observation is admitted."
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "CFTC historical availability probe"
  );
  console.log(
    "----------------------------------"
  );
  console.log(
    `Test year: ${TEST_YEAR}`
  );
  console.log(
    `Archive bytes: ${archiveBytes.length}`
  );
  console.log(
    `ZIP signature valid: ${zipSignatureValid}`
  );
  console.log(
    "Historical values source: VERIFIED"
  );
  console.log(
    "Exact historical AvailableAt: NOT ESTABLISHED"
  );
  console.log(
    "Historical observations admitted: 0"
  );
  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "CFTC historical probe failed:"
  );
  console.error(error);
  process.exit(1);
});

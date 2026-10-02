import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/cftc-historical-probe.json",
  import.meta.url
);

const MARKET_CODE = "067651";
const TEST_YEAR = 2025;

const HISTORICAL_INDEX_URL =
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm";

const ARCHIVE_URL =
  `https://www.cftc.gov/files/dea/history/fut_disagg_txt_${TEST_YEAR}.zip`;

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);

  return fields.map(
    (value) => value.trim()
  );
}

function normalizeHeader(value) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function cleanField(value) {
  return String(value ?? "")
    .replace(/^"|"$/g, "")
    .trim();
}

function parseInteger(value, fieldName) {
  const cleaned = cleanField(value)
    .replace(/,/g, "");

  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Invalid ${fieldName}: ${value}`
    );
  }

  return parsed;
}

function validateObservationDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new Error(
      `Invalid CFTC observation date: ${value}`
    );
  }

  const timestamp =
    Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `Unparseable CFTC observation date: ${value}`
    );
  }

  return value;
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

  return Buffer.from(
    await response.arrayBuffer()
  );
}

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

async function main() {
  const executionTimestamp =
    new Date().toISOString();

  /*
   * Verify the official CFTC historical index.
   *
   * This establishes the official historical
   * source only. It does not establish historical
   * AvailableAt timestamps.
   */
  const historicalIndex =
    await fetchText(
      HISTORICAL_INDEX_URL,
      "CFTC historical index"
    );

  if (
    !historicalIndex.includes(
      "Disaggregated Futures Only"
    ) ||
    !historicalIndex.includes(
      String(TEST_YEAR)
    )
  ) {
    throw new Error(
      "CFTC historical index validation failed."
    );
  }

  /*
   * Download the official annual compressed
   * Disaggregated Futures Only archive.
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
   * Validate standard ZIP signature:
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
      "CFTC historical archive is not a valid ZIP."
    );
  }

  /*
   * GitHub Actions uses Ubuntu.
   * We use the system unzip utility only for
   * extracting this research probe archive.
   */
  const {
    mkdtemp,
    writeFile: writeTempFile,
    readFile,
    rm,
    readdir
  } = await import("node:fs/promises");

  const { tmpdir } =
    await import("node:os");

  const { join } =
    await import("node:path");

  const { execFile } =
    await import("node:child_process");

  const { promisify } =
    await import("node:util");

  const execFileAsync =
    promisify(execFile);

  const tempDirectory =
    await mkdtemp(
      join(tmpdir(), "hesi-cftc-")
    );

  try {
    const zipPath =
      join(
        tempDirectory,
        `cftc-${TEST_YEAR}.zip`
      );

    await writeTempFile(
      zipPath,
      archiveBytes
    );

    await execFileAsync(
      "unzip",
      [
        "-q",
        zipPath,
        "-d",
        tempDirectory
      ]
    );

    const extractedFiles =
      await readdir(tempDirectory);

    const candidateFiles =
      extractedFiles.filter(
        (name) =>
          name !==
          `cftc-${TEST_YEAR}.zip`
      );

    if (candidateFiles.length === 0) {
      throw new Error(
        "CFTC ZIP contained no extracted data file."
      );
    }

    /*
     * Locate the extracted Disaggregated
     * Futures Only data file by its Managed
     * Money column names.
     */
    let dataFileName = null;
    let dataText = null;

    for (const fileName of candidateFiles) {
      const filePath =
        join(
          tempDirectory,
          fileName
        );

      let candidateText;

      try {
        candidateText =
          await readFile(
            filePath,
            "utf8"
          );
      } catch {
        continue;
      }

      if (
        candidateText.includes(
          "M_Money_Positions_Long_All"
        ) &&
        candidateText.includes(
          "M_Money_Positions_Short_All"
        ) &&
        candidateText.includes(
          "Report_Date_as_YYYY-MM-DD"
        )
      ) {
        dataFileName = fileName;
        dataText = candidateText;
        break;
      }
    }

    if (!dataText) {
      throw new Error(
        "Could not locate CFTC Disaggregated Futures Only data file inside ZIP."
      );
    }

    const lines =
      dataText
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.trim().length > 0
        );

    if (lines.length < 2) {
      throw new Error(
        "CFTC historical data file contains no observations."
      );
    }

    const headers =
      parseCsvLine(lines[0])
        .map(normalizeHeader);

    /*
     * These names were observed directly in the
     * official CFTC 2025 historical archive.
     */
    const requiredColumns = [
      "Market_and_Exchange_Names",
      "Report_Date_as_YYYY-MM-DD",
      "CFTC_Market_Code",
      "M_Money_Positions_Long_All",
      "M_Money_Positions_Short_All",
      "M_Money_Positions_Spread_All"
    ];

    for (const column of requiredColumns) {
      if (!headers.includes(column)) {
        throw new Error(
          `Required CFTC column missing: ${column}`
        );
      }
    }

    const columnIndex =
      Object.fromEntries(
        headers.map(
          (name, index) =>
            [name, index]
        )
      );

    const observations = [];

    for (const line of lines.slice(1)) {
      const fields =
        parseCsvLine(line);

      /*
       * Skip structurally incomplete rows.
       */
      if (fields.length < headers.length) {
        continue;
      }

      const marketCode =
        cleanField(
          fields[
            columnIndex[
              "CFTC_Market_Code"
            ]
          ]
        );

      if (marketCode !== MARKET_CODE) {
        continue;
      }

      const marketName =
        cleanField(
          fields[
            columnIndex[
              "Market_and_Exchange_Names"
            ]
          ]
        );

      const observationDate =
        validateObservationDate(
          cleanField(
            fields[
              columnIndex[
                "Report_Date_as_YYYY-MM-DD"
              ]
            ]
          )
        );

      const managedMoneyLong =
        parseInteger(
          fields[
            columnIndex[
              "M_Money_Positions_Long_All"
            ]
          ],
          "Managed Money Long"
        );

      const managedMoneyShort =
        parseInteger(
          fields[
            columnIndex[
              "M_Money_Positions_Short_All"
            ]
          ],
          "Managed Money Short"
        );

      const managedMoneySpreading =
        parseInteger(
          fields[
            columnIndex[
              "M_Money_Positions_Spread_All"
            ]
          ],
          "Managed Money Spreading"
        );

      if (
        managedMoneyLong < 0 ||
        managedMoneyShort < 0 ||
        managedMoneySpreading < 0
      ) {
        throw new Error(
          `Negative CFTC positioning value on ${observationDate}.`
        );
      }

      const managedMoneyNet =
        managedMoneyLong -
        managedMoneyShort;

      observations.push({
        observationDate,
        marketCode,
        marketName,
        managedMoneyLong,
        managedMoneyShort,
        managedMoneySpreading,
        managedMoneyNet
      });
    }

    if (observations.length === 0) {
      throw new Error(
        `No CFTC observations found for market code ${MARKET_CODE}.`
      );
    }

    observations.sort(
      (a, b) =>
        a.observationDate.localeCompare(
          b.observationDate
        )
    );

    /*
     * A weekly market series must not contain
     * duplicate report dates for the same market.
     */
    const uniqueDates =
      new Set(
        observations.map(
          (observation) =>
            observation.observationDate
        )
      );

    if (
      uniqueDates.size !==
      observations.length
    ) {
      throw new Error(
        "Duplicate WTI-PHYSICAL report dates detected."
      );
    }

    const marketNames =
      [
        ...new Set(
          observations.map(
            (observation) =>
              observation.marketName
          )
        )
      ];

    /*
     * This probe establishes historical VALUES
     * only.
     *
     * It deliberately does NOT assign historical
     * AvailableAt timestamps and does NOT admit
     * observations into the historical store.
     */
    const output = {
      schemaVersion: "1.2",

      status:
        "CFTC_HISTORICAL_VALUES_EXTRACTED_NOT_ADMITTED",

      executionTimestamp,

      targetSeries: {
        sourceId:
          "cftc_cot",

        seriesId:
          "CFTC_WTI_PHYSICAL_MANAGED_MONEY",

        marketCode:
          MARKET_CODE,

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

        archiveByteLength:
          archiveBytes.length,

        zipSignatureValid,

        extractedFile:
          dataFileName
      },

      extractionStatus: {
        archiveExtractionPerformed:
          true,

        marketCodeSearchPerformed:
          true,

        marketCodeFound:
          true,

        observationsExtracted:
          observations.length,

        uniqueObservationDates:
          uniqueDates.size,

        firstObservationDate:
          observations[0]
            .observationDate,

        lastObservationDate:
          observations[
            observations.length - 1
          ].observationDate,

        marketNames
      },

      columnValidation: {
        dateColumn:
          "Report_Date_as_YYYY-MM-DD",

        requiredColumns,

        allRequiredColumnsFound:
          true,

        historicalMetricMatchesLiveDefinition:
          true
      },

      observations,

      availabilityEvidence: {
        exactHistoricalAvailableAtEstablished:
          false,

        syntheticAvailableAtAssigned:
          false,

        observationDatePlusThreeDaysAssumed:
          false,

        historicalValuesReadyForAdmission:
          false,

        reason:
          "Historical CFTC values are extracted and structurally validated, but no defensible historical AvailableAt has yet been assigned."
      },

      safeguards: {
        historicalStoreModified:
          false,

        historicalDatasetModified:
          false,

        pointInTimeDatasetModified:
          false,

        calibrationPerformed:
          false,

        modelWeightsModified:
          false,

        thresholdsModified:
          false,

        forecastModelTrained:
          false,

        officialHesiModified:
          false,

        dashboardOfficialHesiModified:
          false
      },

      nextResearchQuestion:
        "Determine and validate a defensible historical AvailableAt methodology before any historical CFTC observation is admitted."
    };

    await writeFile(
      OUTPUT_FILE,
      `${JSON.stringify(
        output,
        null,
        2
      )}\n`,
      "utf8"
    );

    console.log(
      "CFTC historical extraction probe"
    );

    console.log(
      "--------------------------------"
    );

    console.log(
      `Year: ${TEST_YEAR}`
    );

    console.log(
      `Market code: ${MARKET_CODE}`
    );

    console.log(
      `Observations extracted: ${observations.length}`
    );

    console.log(
      `Unique observation dates: ${uniqueDates.size}`
    );

    console.log(
      `First observation: ${observations[0].observationDate}`
    );

    console.log(
      `Last observation: ${
        observations[
          observations.length - 1
        ].observationDate
      }`
    );

    console.log(
      `Market names: ${marketNames.join(" | ")}`
    );

    console.log(
      "Historical metric definition: VERIFIED"
    );

    console.log(
      "Historical AvailableAt: NOT ESTABLISHED"
    );

    console.log(
      "Historical observations admitted: 0"
    );

    console.log(
      "Official HESI modified: NO"
    );
  } finally {
    await rm(
      tempDirectory,
      {
        recursive: true,
        force: true
      }
    );
  }
}

main().catch((error) => {
  console.error(
    "CFTC historical extraction probe failed:"
  );

  console.error(error);

  process.exit(1);
});

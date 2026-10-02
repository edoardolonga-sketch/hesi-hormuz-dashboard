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
  const cleaned =
    cleanField(value).replace(/,/g, "");

  const parsed = Number(cleaned);

  if (!Number.isInteger(parsed)) {
    throw new Error(
      `Invalid integer for ${fieldName}: ${value}`
    );
  }

  return parsed;
}

function validateObservationDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `Invalid CFTC observation date: ${value}`
    );
  }

  const parsed =
    Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Unparseable CFTC observation date: ${value}`
    );
  }

  return value;
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

async function main() {
  const executionTimestamp =
    new Date().toISOString();

  /*
   * Verify official historical source.
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
   * Download official annual archive.
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
     * Locate the Disaggregated Futures Only file.
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
          "CFTC_Contract_Market_Code"
        ) &&
        candidateText.includes(
          "Report_Date_as_YYYY-MM-DD"
        ) &&
        candidateText.includes(
          "M_Money_Positions_Long_All"
        ) &&
        candidateText.includes(
          "M_Money_Positions_Short_All"
        ) &&
        candidateText.includes(
          "M_Money_Positions_Spread_All"
        )
      ) {
        dataFileName = fileName;
        dataText = candidateText;
        break;
      }
    }

    if (!dataText) {
      throw new Error(
        "Could not locate CFTC Disaggregated Futures Only data file."
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

    const requiredColumns = [
      "Market_and_Exchange_Names",
      "Report_Date_as_YYYY-MM-DD",
      "CFTC_Contract_Market_Code",
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

    /*
     * Extract only WTI-PHYSICAL contract 067651.
     *
     * The previous diagnostic established that
     * 067651 belongs in CFTC_Contract_Market_Code.
     */
    const observations = [];

    for (const line of lines.slice(1)) {
      const fields =
        parseCsvLine(line);

      if (fields.length < headers.length) {
        continue;
      }

      const contractMarketCode =
        cleanField(
          fields[
            columnIndex[
              "CFTC_Contract_Market_Code"
            ]
          ]
        );

      if (
        contractMarketCode !==
        MARKET_CODE
      ) {
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

      const cftcMarketCode =
        cleanField(
          fields[
            columnIndex[
              "CFTC_Market_Code"
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
        sourceId:
          "cftc_cot",

        seriesId:
          "CFTC_WTI_PHYSICAL_MANAGED_MONEY",

        observationDate,

        /*
         * Deliberately unresolved.
         *
         * Historical values must not become
         * point-in-time eligible until a separate
         * AvailableAt methodology is validated.
         */
        availableAt: null,

        marketCode:
          MARKET_CODE,

        cftcContractMarketCode:
          contractMarketCode,

        cftcMarketCode,

        marketName,

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

        historicalValueStatus:
          "EXTRACTED_NOT_ADMITTED",

        availableAtStatus:
          "NOT_ESTABLISHED"
      });
    }

    if (observations.length === 0) {
      throw new Error(
        `No CFTC observations found for contract market code ${MARKET_CODE}.`
      );
    }

    observations.sort(
      (a, b) =>
        a.observationDate.localeCompare(
          b.observationDate
        )
    );

    /*
     * Structural uniqueness check.
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

    /*
     * Verify every extracted row belongs to
     * the intended CFTC contract.
     */
    const invalidContractRows =
      observations.filter(
        (observation) =>
          observation.cftcContractMarketCode !==
          MARKET_CODE
      );

    if (invalidContractRows.length > 0) {
      throw new Error(
        "Unexpected CFTC contract market code detected."
      );
    }

    /*
     * Require the expected WTI-PHYSICAL identity.
     */
    const invalidMarketNames =
      observations.filter(
        (observation) =>
          !observation.marketName
            .toUpperCase()
            .includes("WTI-PHYSICAL")
      );

    if (invalidMarketNames.length > 0) {
      throw new Error(
        "Unexpected market name found for CFTC contract 067651."
      );
    }

    /*
     * No historical AvailableAt may appear
     * at this stage.
     */
    const observationsWithAvailableAt =
      observations.filter(
        (observation) =>
          observation.availableAt !== null
      );

    if (
      observationsWithAvailableAt.length > 0
    ) {
      throw new Error(
        "Historical CFTC AvailableAt was unexpectedly assigned."
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

    const exchangeCodes =
      [
        ...new Set(
          observations.map(
            (observation) =>
              observation.cftcMarketCode
          )
        )
      ];

    const output = {
      schemaVersion: "1.4",

      status:
        "CFTC_HISTORICAL_VALUES_PREPARED_AVAILABLE_AT_PENDING_NOT_ADMITTED",

      executionTimestamp,

      targetSeries: {
        sourceId:
          "cftc_cot",

        seriesId:
          "CFTC_WTI_PHYSICAL_MANAGED_MONEY",

        contractMarketCode:
          MARKET_CODE,

        marketName:
          "WTI-PHYSICAL",

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

      columnValidation: {
        contractIdentityColumn:
          "CFTC_Contract_Market_Code",

        dateColumn:
          "Report_Date_as_YYYY-MM-DD",

        exchangeCodeColumn:
          "CFTC_Market_Code",

        managedMoneyLongColumn:
          "M_Money_Positions_Long_All",

        managedMoneyShortColumn:
          "M_Money_Positions_Short_All",

        managedMoneySpreadingColumn:
          "M_Money_Positions_Spread_All",

        historicalMetricMatchesLiveDefinition:
          true
      },

      extractionStatus: {
        archiveExtractionPerformed:
          true,

        contractMarketCodeSearchPerformed:
          true,

        contractMarketCodeFound:
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

        marketNames,

        exchangeCodes,

        observationsWithAvailableAt:
          observationsWithAvailableAt.length
      },

      observations,

      availabilityEvidence: {
        exactHistoricalAvailableAtEstablished:
          false,

        historicalAvailableAtMethodologyApproved:
          false,

        syntheticAvailableAtAssigned:
          false,

        observationDatePlusThreeDaysAssumed:
          false,

        historicalValuesReadyForAdmission:
          false,

        admissionAuthorized:
          false,

        reason:
          "Official historical CFTC WTI-PHYSICAL values are extracted and structurally validated. Historical AvailableAt remains unresolved, so none of these observations are eligible for admission or point-in-time use."
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
        "Determine and validate a defensible historical CFTC AvailableAt methodology before any extracted observation is admitted."
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
      "CFTC historical WTI value extraction"
    );

    console.log(
      "------------------------------------"
    );

    console.log(
      `Year: ${TEST_YEAR}`
    );

    console.log(
      `Contract market code: ${MARKET_CODE}`
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
      `Exchange codes: ${exchangeCodes.join(" | ")}`
    );

    console.log(
      "Managed Money Net = Long - Short: VERIFIED"
    );

    console.log(
      "Historical AvailableAt: NOT ESTABLISHED"
    );

    console.log(
      "Historical observations admitted: 0"
    );

    console.log(
      "Point-in-time dataset modified: NO"
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
    "CFTC historical WTI value extraction failed:"
  );

  console.error(error);

  process.exit(1);
});

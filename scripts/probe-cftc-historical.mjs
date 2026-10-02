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
   * Verify official CFTC historical source.
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
          "CFTC_Market_Code"
        ) &&
        candidateText.includes(
          "M_Money_Positions_Long_All"
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
     * Diagnostic search.
     *
     * We do NOT decide yet which CFTC code
     * column identifies WTI-PHYSICAL.
     *
     * Instead we search MARKET_CODE in both
     * official columns and preserve the evidence.
     */
    const contractMarketMatches = [];
    const marketCodeMatches = [];
    const nameMatches = [];

    for (const line of lines.slice(1)) {
      const fields =
        parseCsvLine(line);

      if (fields.length < headers.length) {
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
        cleanField(
          fields[
            columnIndex[
              "Report_Date_as_YYYY-MM-DD"
            ]
          ]
        );

      const contractMarketCode =
        cleanField(
          fields[
            columnIndex[
              "CFTC_Contract_Market_Code"
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

      const sample = {
        observationDate,
        marketName,
        cftcContractMarketCode:
          contractMarketCode,
        cftcMarketCode
      };

      if (
        contractMarketCode ===
        MARKET_CODE
      ) {
        contractMarketMatches.push(
          sample
        );
      }

      if (
        cftcMarketCode ===
        MARKET_CODE
      ) {
        marketCodeMatches.push(
          sample
        );
      }

      if (
        marketName
          .toUpperCase()
          .includes("WTI") &&
        marketName
          .toUpperCase()
          .includes("PHYSICAL")
      ) {
        nameMatches.push(
          sample
        );
      }
    }

    /*
     * Keep the artifact compact.
     * Counts cover the full file; samples retain
     * only the first few matching rows.
     */
    const SAMPLE_LIMIT = 10;

    const diagnostic = {
      schemaVersion: "1.3",

      status:
        "CFTC_HISTORICAL_MARKET_CODE_DIAGNOSTIC_NOT_ADMITTED",

      executionTimestamp,

      target: {
        requestedMarketCode:
          MARKET_CODE,

        expectedMarketName:
          "WTI-PHYSICAL",

        sourceId:
          "cftc_cot",

        seriesId:
          "CFTC_WTI_PHYSICAL_MANAGED_MONEY"
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

      codeSearch: {
        cftcContractMarketCode: {
          column:
            "CFTC_Contract_Market_Code",

          requestedCode:
            MARKET_CODE,

          matchCount:
            contractMarketMatches.length,

          firstMatches:
            contractMarketMatches.slice(
              0,
              SAMPLE_LIMIT
            )
        },

        cftcMarketCode: {
          column:
            "CFTC_Market_Code",

          requestedCode:
            MARKET_CODE,

          matchCount:
            marketCodeMatches.length,

          firstMatches:
            marketCodeMatches.slice(
              0,
              SAMPLE_LIMIT
            )
        },

        marketNameSearch: {
          rule:
            "Market_and_Exchange_Names contains both WTI and PHYSICAL",

          matchCount:
            nameMatches.length,

          firstMatches:
            nameMatches.slice(
              0,
              SAMPLE_LIMIT
            )
        }
      },

      availabilityEvidence: {
        exactHistoricalAvailableAtEstablished:
          false,

        syntheticAvailableAtAssigned:
          false,

        historicalValuesAdmitted:
          false
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

      interpretation:
        "Diagnostic only. This artifact determines which official CFTC code column identifies the target WTI-PHYSICAL historical rows. It does not admit observations or assign historical AvailableAt."
    };

    await writeFile(
      OUTPUT_FILE,
      `${JSON.stringify(
        diagnostic,
        null,
        2
      )}\n`,
      "utf8"
    );

    console.log(
      "CFTC historical market-code diagnostic"
    );

    console.log(
      "--------------------------------------"
    );

    console.log(
      `Requested code: ${MARKET_CODE}`
    );

    console.log(
      `CFTC_Contract_Market_Code matches: ${contractMarketMatches.length}`
    );

    console.log(
      `CFTC_Market_Code matches: ${marketCodeMatches.length}`
    );

    console.log(
      `WTI-PHYSICAL name matches: ${nameMatches.length}`
    );

    if (contractMarketMatches.length > 0) {
      console.log(
        "First Contract Market Code match:"
      );

      console.log(
        contractMarketMatches[0]
      );
    }

    if (marketCodeMatches.length > 0) {
      console.log(
        "First CFTC Market Code match:"
      );

      console.log(
        marketCodeMatches[0]
      );
    }

    if (nameMatches.length > 0) {
      console.log(
        "First WTI-PHYSICAL name match:"
      );

      console.log(
        nameMatches[0]
      );
    }

    console.log(
      "Historical observations admitted: 0"
    );

    console.log(
      "Historical AvailableAt assigned: NO"
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
    "CFTC historical market-code diagnostic failed:"
  );

  console.error(error);

  process.exit(1);
});

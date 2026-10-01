import { writeFile } from "node:fs/promises";

const SERIES_ID = "DCOILBRENTEU";

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-candidates.json",
  import.meta.url
);

const RAW_API_KEY =
  process.env.FRED_API_KEY ?? "";

const API_KEY =
  RAW_API_KEY.trim();

if (!API_KEY) {
  console.error(
    "Missing FRED_API_KEY environment variable."
  );
  process.exit(1);
}

if (!/^[a-z0-9]{32}$/.test(API_KEY)) {
  console.error(
    "FRED_API_KEY does not have the expected 32-character lowercase alphanumeric format."
  );
  process.exit(1);
}

const VINTAGE_DATES_URL =
  "https://api.stlouisfed.org/fred/series/vintagedates";

const OBSERVATIONS_URL =
  "https://api.stlouisfed.org/fred/series/observations";

async function fetchJson(url, params) {
  const requestUrl =
    new URL(url);

  for (const [key, value] of
    Object.entries(params)) {
    requestUrl.searchParams.set(
      key,
      String(value)
    );
  }

  const response =
    await fetch(requestUrl);

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `FRED/ALFRED request failed: HTTP ${response.status}\n${body}`
    );
  }

  return response.json();
}

function conservativeAvailableAt(
  realtimeStart
) {
  /*
   * ALFRED gives us historical availability
   * at daily resolution, not a defensible
   * intraday publication timestamp.
   *
   * To avoid pretending the value was known
   * at the beginning of realtime_start,
   * availability is conservatively assigned
   * to the END of that UTC calendar day.
   *
   * This is a methodological convention,
   * explicitly retained in every candidate.
   */

  return `${realtimeStart}T23:59:59.999Z`;
}

async function main() {
  const buildTimestamp =
    new Date().toISOString();

  console.log(
    "Build ALFRED Brent admission candidates"
  );

  console.log(
    "---------------------------------------"
  );

  const vintageData =
    await fetchJson(
      VINTAGE_DATES_URL,
      {
        series_id: SERIES_ID,
        api_key: API_KEY,
        file_type: "json",
        sort_order: "asc",
        limit: 10000
      }
    );

  const vintageDates =
    Array.isArray(
      vintageData.vintage_dates
    )
      ? vintageData.vintage_dates
      : [];

  if (vintageDates.length === 0) {
    throw new Error(
      "No ALFRED vintage dates were returned."
    );
  }

  const firstVintageDate =
    vintageDates[0];

  const lastVintageDate =
    vintageDates[
      vintageDates.length - 1
    ];

  const initialReleaseData =
    await fetchJson(
      OBSERVATIONS_URL,
      {
        series_id: SERIES_ID,
        api_key: API_KEY,
        file_type: "json",
        realtime_start:
          firstVintageDate,
        realtime_end:
          lastVintageDate,
        output_type: 4,
        observation_start:
          "1987-01-01",
        sort_order: "asc",
        limit: 100000
      }
    );

  const observations =
    Array.isArray(
      initialReleaseData.observations
    )
      ? initialReleaseData.observations
      : [];

  const candidates = [];

  for (const observation of observations) {
    if (
      !observation.value ||
      observation.value === "."
    ) {
      continue;
    }

    const value =
      Number(observation.value);

    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      continue;
    }

    if (!observation.realtime_start) {
      continue;
    }

    if (!observation.date) {
      continue;
    }

    candidates.push({
      sourceId: "brent_market",
      seriesId: SERIES_ID,

      observationDate:
        observation.date,

      availableAt:
        conservativeAvailableAt(
          observation.realtime_start
        ),

      value,

      unit:
        "usd_per_barrel",

      frequency:
        "daily",

      availableAtEvidence: {
        provider:
          "Federal Reserve Bank of St. Louis FRED/ALFRED",

        endpoint:
          "fred/series/observations",

        outputType:
          4,

        realtimeStart:
          observation.realtime_start,

        realtimeEnd:
          observation.realtime_end ?? null,

        interpretation:
          "ALFRED initial-release observation with historical real-time metadata."
      },

      availableAtMethod:
        "ALFRED_INITIAL_RELEASE_REALTIME_START_END_OF_DAY_UTC",

      admissionStatus:
        "CANDIDATE_REQUIRES_METHOD_REVIEW"
    });
  }

  const output = {
    schemaVersion: "1.0",

    status:
      "ALFRED_HISTORICAL_CANDIDATES_NOT_ADMITTED",

    buildTimestamp,

    sourceId:
      "brent_market",

    seriesId:
      SERIES_ID,

    vintageCoverage: {
      vintageDateCount:
        vintageDates.length,

      firstVintageDate,

      lastVintageDate
    },

    methodology: {
      source:
        "FRED/ALFRED historical real-time observations",

      queryMode:
        "output_type=4 Initial Release Only",

      availableAtBasis:
        "observation.realtime_start",

      intradayPrecision:
        "NOT_AVAILABLE_FROM_THIS QUERY",

      conservativeConvention:
        "AvailableAt is assigned to 23:59:59.999Z on realtime_start so the model cannot use the observation earlier within that calendar day.",

      automaticAdmission:
        false
    },

    summary: {
      apiObservations:
        observations.length,

      candidateObservations:
        candidates.length,

      admittedObservations:
        0
    },

    candidates,

    promotion: {
      historicalStoreUpdated:
        false,

      calibrationDatasetUpdated:
        false,

      officialHesiUpdated:
        false
    },

    notes: [
      "This file contains admission candidates, not admitted historical observations.",
      "ALFRED realtime_start is retained as explicit availability evidence.",
      "The end-of-day UTC AvailableAt timestamp is a conservative methodological convention because this query does not establish an intraday publication time.",
      "No candidate is automatically promoted into historical-observations.json.",
      "A separate admission review must approve the methodology before these observations may enter leakage-safe calibration."
    ]
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
    `Vintage dates: ${vintageDates.length}`
  );

  console.log(
    `API observations: ${observations.length}`
  );

  console.log(
    `Candidates: ${candidates.length}`
  );

  console.log(
    "Automatically admitted: 0"
  );

  console.log(
    "Historical store modified: NO"
  );

  console.log(
    "Calibration dataset modified: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "ALFRED candidate build failed:"
  );

  console.error(
    error.message
  );

  process.exit(1);
});

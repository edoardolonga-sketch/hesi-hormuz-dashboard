const SERIES_ID = "DCOILBRENTEU";

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

async function main() {
  console.log(
    "ALFRED Brent historical-availability probe"
  );

  console.log(
    "------------------------------------------"
  );

  console.log(
    `Series: ${SERIES_ID}`
  );

  /*
   * STEP 1
   * Retrieve all historical vintage dates
   * recorded by FRED/ALFRED for Brent.
   */

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

  console.log(
    `Vintage dates returned: ${vintageDates.length}`
  );

  console.log(
    `First vintage date: ${firstVintageDate}`
  );

  console.log(
    `Last vintage date: ${lastVintageDate}`
  );

  /*
   * STEP 2
   * Query initial-release observations
   * using the actual ALFRED real-time range.
   *
   * This avoids asking ALFRED for a real-time
   * date newer than its latest available vintage.
   *
   * output_type=4 = Initial Release Only.
   */

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

  const usable =
    observations.filter(
      (observation) =>
        observation.value &&
        observation.value !== "."
    );

  console.log(
    `Initial-release observations returned: ${observations.length}`
  );

  console.log(
    `Usable initial-release observations: ${usable.length}`
  );

  if (usable.length > 0) {
    console.log(
      "First usable initial-release observation:"
    );

    console.log(
      JSON.stringify(
        usable[0],
        null,
        2
      )
    );

    console.log(
      "Last usable initial-release observation:"
    );

    console.log(
      JSON.stringify(
        usable[
          usable.length - 1
        ],
        null,
        2
      )
    );
  }

  console.log("");
  console.log(
    "Probe completed successfully."
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
    "ALFRED probe failed:"
  );

  console.error(
    error.message
  );

  process.exit(1);
});

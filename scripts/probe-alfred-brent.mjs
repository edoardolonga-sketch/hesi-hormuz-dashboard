const SERIES_ID = "DCOILBRENTEU";

const RAW_API_KEY =
  process.env.FRED_API_KEY ?? "";

const API_KEY =
  RAW_API_KEY.trim();

console.log(
  "FRED_API_KEY diagnostic"
);

console.log(
  "-----------------------"
);

console.log(
  `Secret present: ${RAW_API_KEY.length > 0 ? "YES" : "NO"}`
);

console.log(
  `Raw length: ${RAW_API_KEY.length}`
);

console.log(
  `Trimmed length: ${API_KEY.length}`
);

console.log(
  `Valid FRED format: ${
    /^[a-z0-9]{32}$/.test(API_KEY)
      ? "YES"
      : "NO"
  }`
);

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
  console.log("");
  console.log(
    "ALFRED Brent historical-availability probe"
  );

  console.log(
    "------------------------------------------"
  );

  console.log(
    `Series: ${SERIES_ID}`
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

  console.log(
    `Vintage dates returned: ${vintageDates.length}`
  );

  console.log(
    `First vintage date: ${
      vintageDates[0] ?? "NONE"
    }`
  );

  console.log(
    `Last vintage date: ${
      vintageDates[
        vintageDates.length - 1
      ] ?? "NONE"
    }`
  );

  if (vintageDates.length === 0) {
    throw new Error(
      "No ALFRED vintage dates were returned."
    );
  }

  const initialReleaseData =
    await fetchJson(
      OBSERVATIONS_URL,
      {
        series_id: SERIES_ID,
        api_key: API_KEY,
        file_type: "json",
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

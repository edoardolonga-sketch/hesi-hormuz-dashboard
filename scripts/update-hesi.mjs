import { readFile } from "node:fs/promises";

const DATA_FILE = new URL(
  "../data/dashboard-data.json",
  import.meta.url
);

const SOURCES_FILE = new URL(
  "../data/sources.json",
  import.meta.url
);

const OBSERVATIONS_FILE = new URL(
  "../data/latest-observations.json",
  import.meta.url
);

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

async function main() {
  const data = await readJson(
    DATA_FILE,
    "dashboard-data.json"
  );

  const sourceRegistry = await readJson(
    SOURCES_FILE,
    "sources.json"
  );

  const latestObservations = await readJson(
    OBSERVATIONS_FILE,
    "latest-observations.json"
  );

  /*
   * Validate HESI dashboard data
   */
  if (!data.hesi) {
    throw new Error(
      "Missing HESI block in dashboard-data.json"
    );
  }

  if (!data.hesi.asOf) {
    throw new Error(
      "Missing HESI asOf date"
    );
  }

  const requiredHesiFields = [
    "effective",
    "physical",
    "market"
  ];

  for (const field of requiredHesiFields) {
    if (!isFiniteNumber(data.hesi[field])) {
      throw new Error(
        `Invalid or missing HESI field: ${field}`
      );
    }

    if (
      data.hesi[field] < 0 ||
      data.hesi[field] > 100
    ) {
      throw new Error(
        `HESI field outside 0-100 range: ${field}`
      );
    }
  }

  /*
   * Validate source registry
   */
  if (!sourceRegistry.availableAtPolicy) {
    throw new Error(
      "Missing AvailableAt policy in sources.json"
    );
  }

  if (
    !Array.isArray(sourceRegistry.sources) ||
    sourceRegistry.sources.length === 0
  ) {
    throw new Error(
      "No sources defined in sources.json"
    );
  }

  const ids = new Set();

  for (const source of sourceRegistry.sources) {
    if (
      !source.id ||
      !source.name ||
      !source.domain ||
      !source.status
    ) {
      throw new Error(
        "Incomplete source definition in sources.json"
      );
    }

    if (ids.has(source.id)) {
      throw new Error(
        `Duplicate source id: ${source.id}`
      );
    }

    ids.add(source.id);

    if (source.availableAtRequired !== true) {
      throw new Error(
        `AvailableAt protection is not enabled for source: ${source.id}`
      );
    }
  }

  /*
   * Validate latest observations
   */
  if (
    !Array.isArray(
      latestObservations.observations
    )
  ) {
    throw new Error(
      "Missing observations array in latest-observations.json"
    );
  }

  if (
    latestObservations.executionTimestamp !== null &&
    typeof latestObservations.executionTimestamp !==
      "string"
  ) {
    throw new Error(
      "Invalid executionTimestamp"
    );
  }

  const executionTime =
    latestObservations.executionTimestamp
      ? new Date(
          latestObservations.executionTimestamp
        ).getTime()
      : null;

  if (
    executionTime !== null &&
    !Number.isFinite(executionTime)
  ) {
    throw new Error(
      "Invalid executionTimestamp date"
    );
  }

  for (
    const observation of
    latestObservations.observations
  ) {
    if (!observation.sourceId) {
      throw new Error(
        "Observation missing sourceId"
      );
    }

    if (!ids.has(observation.sourceId)) {
      throw new Error(
        `Observation uses unknown source: ${observation.sourceId}`
      );
    }

    /*
     * EIA WPSR validation
     */
    if (
      observation.sourceId === "eia_wpsr"
    ) {
      if (
        observation.seriesId !==
          "WCESTUS1" ||
        !isFiniteNumber(
          observation.value
        ) ||
        observation.unit !==
          "thousand_barrels" ||
        !observation.releaseDate
      ) {
        throw new Error(
          "Invalid EIA WPSR observation."
        );
      }
    }

    /*
     * Brent validation
     */
    if (
      observation.sourceId ===
      "brent_market"
    ) {
      if (
        observation.seriesId !==
          "DCOILBRENTEU" ||
        !isFiniteNumber(
          observation.value
        ) ||
        observation.value <= 0 ||
        observation.unit !==
          "usd_per_barrel" ||
        observation.frequency !==
          "daily"
      ) {
        throw new Error(
          "Invalid Brent observation."
        );
      }
    }

    /*
     * CFTC WTI Managed Money validation
     */
    if (
      observation.sourceId ===
      "cftc_cot"
    ) {
      if (
        observation.seriesId !==
          "CFTC_WTI_PHYSICAL_MANAGED_MONEY" ||
        observation.marketCode !==
          "067651" ||
        !isFiniteNumber(
          observation.managedMoneyLong
        ) ||
        !isFiniteNumber(
          observation.managedMoneyShort
        ) ||
        !isFiniteNumber(
          observation.managedMoneySpreading
        ) ||
        !isFiniteNumber(
          observation.managedMoneyNet
        ) ||
        !isFiniteNumber(
          observation.value
        ) ||
        observation.unit !==
          "contracts" ||
        observation.frequency !==
          "weekly"
      ) {
        throw new Error(
          "Invalid CFTC WTI observation."
        );
      }

      if (
        observation.managedMoneyLong < 0 ||
        observation.managedMoneyShort < 0 ||
        observation.managedMoneySpreading < 0
      ) {
        throw new Error(
          "Invalid negative CFTC positioning value."
        );
      }

      const calculatedNet =
        observation.managedMoneyLong -
        observation.managedMoneyShort;

      if (
        observation.managedMoneyNet !==
          calculatedNet ||
        observation.value !==
          calculatedNet
      ) {
        throw new Error(
          "CFTC Managed Money net consistency check failed."
        );
      }
    }

    /*
     * AvailableAt validation
     */
    if (
      !observation.observationDate ||
      !observation.availableAt
    ) {
      throw new Error(
        `Observation missing date metadata: ${observation.sourceId}`
      );
    }

    const availableTime =
      new Date(
        observation.availableAt
      ).getTime();

    if (!Number.isFinite(availableTime)) {
      throw new Error(
        `Invalid AvailableAt timestamp for source: ${observation.sourceId}`
      );
    }

    if (
      executionTime !== null &&
      availableTime > executionTime
    ) {
      throw new Error(
        `AvailableAt violation for source: ${observation.sourceId}`
      );
    }
  }

  console.log(
    "HESI pipeline validation"
  );
  console.log(
    "------------------------"
  );
  console.log(
    `Available checkpoint: ${data.hesi.asOf}`
  );
  console.log(
    `HESI Effective: ${data.hesi.effective}`
  );
  console.log(
    `Physical Stress: ${data.hesi.physical}`
  );
  console.log(
    `Market Stress: ${data.hesi.market}`
  );
  console.log(
    `Registered sources: ${sourceRegistry.sources.length}`
  );
  console.log(
    `Validated observations: ${latestObservations.observations.length}`
  );
  console.log(
    "EIA validation: ENABLED"
  );
  console.log(
    "Brent validation: ENABLED"
  );
  console.log(
    "CFTC validation: ENABLED"
  );
  console.log(
    "AvailableAt protection: ENABLED"
  );
  console.log("");
  console.log(
    "Validation passed."
  );
  console.log(
    "No dashboard data were modified."
  );
}

main().catch((error) => {
  console.error(
    "HESI pipeline failed:"
  );
  console.error(error);
  process.exit(1);
});

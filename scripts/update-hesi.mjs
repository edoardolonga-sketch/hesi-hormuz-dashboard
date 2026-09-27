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

const COMPUTED_FILE = new URL(
  "../data/hesi-computed.json",
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

function almostEqual(a, b, tolerance = 0.000001) {
  return Math.abs(a - b) <= tolerance;
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

  const computed = await readJson(
    COMPUTED_FILE,
    "hesi-computed.json"
  );

  /*
   * Validate official dashboard HESI
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
    typeof latestObservations.executionTimestamp !== "string"
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
     * EIA WPSR
     */
    if (
      observation.sourceId === "eia_wpsr"
    ) {
      if (
        observation.seriesId !== "WCESTUS1" ||
        !isFiniteNumber(observation.value) ||
        observation.unit !== "thousand_barrels" ||
        !observation.releaseDate
      ) {
        throw new Error(
          "Invalid EIA WPSR observation."
        );
      }
    }

    /*
     * Brent
     */
    if (
      observation.sourceId === "brent_market"
    ) {
      if (
        observation.seriesId !== "DCOILBRENTEU" ||
        !isFiniteNumber(observation.value) ||
        observation.value <= 0 ||
        observation.unit !== "usd_per_barrel" ||
        observation.frequency !== "daily"
      ) {
        throw new Error(
          "Invalid Brent observation."
        );
      }
    }

    /*
     * CFTC WTI Managed Money
     */
    if (
      observation.sourceId === "cftc_cot"
    ) {
      if (
        observation.seriesId !==
          "CFTC_WTI_PHYSICAL_MANAGED_MONEY" ||
        observation.marketCode !== "067651" ||
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
        !isFiniteNumber(observation.value) ||
        observation.unit !== "contracts" ||
        observation.frequency !== "weekly"
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
     * AvailableAt
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

  /*
   * Validate experimental HESI computation
   */
  if (
    computed.status !==
    "EXPERIMENTAL_NOT_PROMOTED"
  ) {
    throw new Error(
      "Unexpected computed HESI promotion status."
    );
  }

  if (
    computed.availableAtProtection !==
    "ENABLED"
  ) {
    throw new Error(
      "Computed HESI AvailableAt protection is not enabled."
    );
  }

  if (
    computed.promotion?.dashboardUpdated !== false ||
    computed.promotion?.officialHesiUpdated !== false
  ) {
    throw new Error(
      "Experimental HESI must not be promoted automatically."
    );
  }

  if (
    !isFiniteNumber(
      computed.components?.brentStress
    ) ||
    computed.components.brentStress < 0 ||
    computed.components.brentStress > 100
  ) {
    throw new Error(
      "Invalid computed Brent stress."
    );
  }

  if (
    !isFiniteNumber(
      computed.components?.cftcPositioningStress
    ) ||
    computed.components.cftcPositioningStress < 0 ||
    computed.components.cftcPositioningStress > 100
  ) {
    throw new Error(
      "Invalid computed CFTC stress."
    );
  }

  if (
    !isFiniteNumber(
      computed.marketStressExperimental
    ) ||
    computed.marketStressExperimental < 0 ||
    computed.marketStressExperimental > 100
  ) {
    throw new Error(
      "Invalid experimental Market Stress."
    );
  }

  if (
    computed.weights?.brent !== 0.7 ||
    computed.weights?.cftc !== 0.3
  ) {
    throw new Error(
      "Unexpected experimental Market Stress weights."
    );
  }

  const weightSum =
    computed.weights.brent +
    computed.weights.cftc;

  if (!almostEqual(weightSum, 1)) {
    throw new Error(
      "Experimental weights do not sum to 1."
    );
  }

  const expectedMarketStress =
    computed.weights.brent *
      computed.components.brentStress +
    computed.weights.cftc *
      computed.components.cftcPositioningStress;

  if (
    !almostEqual(
      computed.marketStressExperimental,
      expectedMarketStress
    )
  ) {
    throw new Error(
      "Experimental Market Stress consistency check failed."
    );
  }

  /*
   * Verify computed inputs match the accepted
   * observations used by the pipeline.
   */
  const brentObservation =
    latestObservations.observations.find(
      (item) =>
        item.sourceId === "brent_market"
    );

  const cftcObservation =
    latestObservations.observations.find(
      (item) =>
        item.sourceId === "cftc_cot"
    );

  if (!brentObservation || !cftcObservation) {
    throw new Error(
      "Missing source observation for computed HESI validation."
    );
  }

  if (
    computed.inputs?.brent?.value !==
      brentObservation.value ||
    computed.inputs?.brent?.observationDate !==
      brentObservation.observationDate ||
    computed.inputs?.brent?.availableAt !==
      brentObservation.availableAt
  ) {
    throw new Error(
      "Computed Brent input does not match accepted observation."
    );
  }

  if (
    computed.inputs?.cftc?.managedMoneyNet !==
      cftcObservation.managedMoneyNet ||
    computed.inputs?.cftc?.observationDate !==
      cftcObservation.observationDate ||
    computed.inputs?.cftc?.availableAt !==
      cftcObservation.availableAt
  ) {
    throw new Error(
      "Computed CFTC input does not match accepted observation."
    );
  }

  const computedExecutionTime =
    new Date(
      computed.executionTimestamp
    ).getTime();

  if (
    !Number.isFinite(
      computedExecutionTime
    )
  ) {
    throw new Error(
      "Invalid computed HESI executionTimestamp."
    );
  }

  const brentAvailableTime =
    new Date(
      computed.inputs.brent.availableAt
    ).getTime();

  const cftcAvailableTime =
    new Date(
      computed.inputs.cftc.availableAt
    ).getTime();

  if (
    brentAvailableTime >
      computedExecutionTime ||
    cftcAvailableTime >
      computedExecutionTime
  ) {
    throw new Error(
      "Computed HESI AvailableAt violation."
    );
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
    `Official HESI Effective: ${data.hesi.effective}`
  );
  console.log(
    `Official Physical Stress: ${data.hesi.physical}`
  );
  console.log(
    `Official Market Stress: ${data.hesi.market}`
  );
  console.log(
    `Experimental Market Stress: ${computed.marketStressExperimental}`
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
    "Computed HESI validation: ENABLED"
  );
  console.log(
    "AvailableAt protection: ENABLED"
  );
  console.log(
    "Automatic promotion: DISABLED"
  );
  console.log("");
  console.log(
    "Validation passed."
  );
  console.log(
    "Official dashboard HESI was not modified."
  );
}

main().catch((error) => {
  console.error(
    "HESI pipeline failed:"
  );
  console.error(error);
  process.exit(1);
});

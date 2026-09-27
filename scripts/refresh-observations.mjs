import { readFile, writeFile } from "node:fs/promises";

const SOURCES_FILE = new URL(
  "../data/sources.json",
  import.meta.url
);

const OBSERVATIONS_FILE = new URL(
  "../data/latest-observations.json",
  import.meta.url
);

const HISTORICAL_FILE = new URL(
  "../data/historical-observations.json",
  import.meta.url
);

const EIA_WPSR_FILE = new URL(
  "../data/eia-wpsr-latest.json",
  import.meta.url
);

const BRENT_FILE = new URL(
  "../data/brent-latest.json",
  import.meta.url
);

const CFTC_FILE = new URL(
  "../data/cftc-latest.json",
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

function validateAvailableAt(
  observation,
  executionTimestamp
) {
  if (!observation.availableAt) {
    throw new Error(
      `${observation.sourceId} observation has no AvailableAt timestamp.`
    );
  }

  const availableAt =
    new Date(observation.availableAt).getTime();

  const executionTime =
    new Date(executionTimestamp).getTime();

  if (
    !Number.isFinite(availableAt) ||
    !Number.isFinite(executionTime)
  ) {
    throw new Error(
      `${observation.sourceId} has an invalid AvailableAt timestamp.`
    );
  }

  if (availableAt > executionTime) {
    throw new Error(
      `${observation.sourceId} observation is not yet available.`
    );
  }
}

function preserveFirstAvailableAt(
  candidate,
  currentObservations
) {
  const previous = currentObservations.find(
    (observation) =>
      observation.sourceId === candidate.sourceId &&
      observation.seriesId === candidate.seriesId &&
      observation.observationDate ===
        candidate.observationDate &&
      observation.value === candidate.value
  );

  if (!previous) {
    return candidate;
  }

  return {
    ...candidate,
    availableAt: previous.availableAt
  };
}

function historicalKey(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

function appendHistoricalObservations(
  historicalObservations,
  candidates
) {
  const existingKeys = new Set(
    historicalObservations.map(
      historicalKey
    )
  );

  const output = [
    ...historicalObservations
  ];

  let added = 0;

  for (const candidate of candidates) {
    const key =
      historicalKey(candidate);

    if (existingKeys.has(key)) {
      continue;
    }

    output.push({
      ...candidate
    });

    existingKeys.add(key);
    added += 1;
  }

  return {
    observations: output,
    added
  };
}

async function main() {
  const executionTimestamp =
    new Date().toISOString();

  const sourceRegistry = await readJson(
    SOURCES_FILE,
    "sources.json"
  );

  const current = await readJson(
    OBSERVATIONS_FILE,
    "latest-observations.json"
  );

  const historical = await readJson(
    HISTORICAL_FILE,
    "historical-observations.json"
  );

  const eiaWpsr = await readJson(
    EIA_WPSR_FILE,
    "eia-wpsr-latest.json"
  );

  const brent = await readJson(
    BRENT_FILE,
    "brent-latest.json"
  );

  const cftc = await readJson(
    CFTC_FILE,
    "cftc-latest.json"
  );

  if (!Array.isArray(sourceRegistry.sources)) {
    throw new Error(
      "No source registry found."
    );
  }

  if (!Array.isArray(current.observations)) {
    throw new Error(
      "Invalid observations array."
    );
  }

  if (!Array.isArray(historical.observations)) {
    throw new Error(
      "Invalid historical observations array."
    );
  }

  const registeredSourceIds = new Set(
    sourceRegistry.sources.map(
      (source) => source.id
    )
  );

  for (const sourceId of [
    eiaWpsr.sourceId,
    brent.sourceId,
    cftc.sourceId
  ]) {
    if (!registeredSourceIds.has(sourceId)) {
      throw new Error(
        `Observation source is not registered: ${sourceId}`
      );
    }
  }

  validateAvailableAt(
    eiaWpsr,
    executionTimestamp
  );

  validateAvailableAt(
    brent,
    executionTimestamp
  );

  validateAvailableAt(
    cftc,
    executionTimestamp
  );

  const eiaCandidate =
    preserveFirstAvailableAt(
      {
        sourceId: eiaWpsr.sourceId,
        seriesId: eiaWpsr.seriesId,
        observationDate:
          eiaWpsr.observationDate,
        availableAt:
          eiaWpsr.availableAt,
        value:
          eiaWpsr.value,
        unit:
          eiaWpsr.unit,
        releaseDate:
          eiaWpsr.releaseDate
      },
      current.observations
    );

  const brentCandidate =
    preserveFirstAvailableAt(
      {
        sourceId: brent.sourceId,
        seriesId: brent.seriesId,
        observationDate:
          brent.observationDate,
        availableAt:
          brent.availableAt,
        value:
          brent.value,
        unit:
          brent.unit,
        frequency:
          brent.frequency
      },
      current.observations
    );

  /*
   * For CFTC, value = Managed Money Net.
   * This preserves the first AvailableAt
   * when the weekly observation is unchanged.
   */
  const cftcCandidate =
    preserveFirstAvailableAt(
      {
        sourceId: cftc.sourceId,
        seriesId: cftc.seriesId,
        marketCode:
          cftc.marketCode,
        observationDate:
          cftc.observationDate,
        availableAt:
          cftc.availableAt,
        value:
          cftc.managedMoneyNet,
        managedMoneyLong:
          cftc.managedMoneyLong,
        managedMoneyShort:
          cftc.managedMoneyShort,
        managedMoneySpreading:
          cftc.managedMoneySpreading,
        managedMoneyNet:
          cftc.managedMoneyNet,
        unit:
          cftc.unit,
        frequency:
          cftc.frequency
      },
      current.observations
    );

  const candidates = [
    eiaCandidate,
    brentCandidate,
    cftcCandidate
  ];

  /*
   * Revalidate the final candidates after
   * first-observed AvailableAt preservation.
   */
  for (const candidate of candidates) {
    validateAvailableAt(
      candidate,
      executionTimestamp
    );
  }

  const managedSourceIds = new Set(
    candidates.map(
      (candidate) =>
        candidate.sourceId
    )
  );

  const newObservations = [
    ...current.observations.filter(
      (observation) =>
        !managedSourceIds.has(
          observation.sourceId
        )
    ),
    ...candidates
  ];

  const observationsChanged =
    JSON.stringify(
      current.observations
    ) !==
    JSON.stringify(
      newObservations
    );

  /*
   * Append only observations genuinely
   * admitted by this pipeline.
   *
   * Existing source/series/date keys are
   * never duplicated.
   *
   * We retain the original AvailableAt
   * already preserved above.
   */
  const historicalResult =
    appendHistoricalObservations(
      historical.observations,
      candidates
    );

  const historicalChanged =
    historicalResult.added > 0;

  if (observationsChanged) {
    const output = {
      ...current,
      updatedAt:
        executionTimestamp,
      executionTimestamp,
      observations:
        newObservations,
      notes:
        current.notes
    };

    await writeFile(
      OBSERVATIONS_FILE,
      `${JSON.stringify(
        output,
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  if (historicalChanged) {
    const historicalOutput = {
      ...historical,
      observations:
        historicalResult.observations
    };

    await writeFile(
      HISTORICAL_FILE,
      `${JSON.stringify(
        historicalOutput,
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  console.log(
    "HESI observation refresh"
  );
  console.log(
    "------------------------"
  );

  console.log(
    `Execution timestamp: ${executionTimestamp}`
  );

  console.log(
    `Registered sources: ${sourceRegistry.sources.length}`
  );

  console.log(
    `Latest observations: ${newObservations.length}`
  );

  console.log(
    `Historical observations: ${historicalResult.observations.length}`
  );

  console.log(
    `New historical observations added: ${historicalResult.added}`
  );

  if (!observationsChanged) {
    console.log(
      "No new latest observation changes."
    );
  }

  if (!historicalChanged) {
    console.log(
      "No new historical observations to append."
    );
  }

  console.log(
    "Original AvailableAt timestamps preserved."
  );

  console.log(
    "Historical duplicate protection: ENABLED"
  );

  console.log(
    "AvailableAt rule: ENABLED"
  );

  console.log(
    "No observations were invented or backfilled."
  );
}

main().catch((error) => {
  console.error(
    "Observation refresh failed:"
  );
  console.error(error);
  process.exit(1);
});

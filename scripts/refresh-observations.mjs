import { readFile, writeFile } from "node:fs/promises";

const SOURCES_FILE = new URL(
  "../data/sources.json",
  import.meta.url
);

const OBSERVATIONS_FILE = new URL(
  "../data/latest-observations.json",
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

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function validateAvailableAt(observation, executionTimestamp) {
  if (!observation.availableAt) {
    throw new Error(
      `${observation.sourceId} observation has no AvailableAt timestamp.`
    );
  }

  if (
    new Date(observation.availableAt).getTime() >
    new Date(executionTimestamp).getTime()
  ) {
    throw new Error(
      `${observation.sourceId} observation is not yet available.`
    );
  }
}

function preserveFirstAvailableAt(candidate, currentObservations) {
  const previous = currentObservations.find(
    (observation) =>
      observation.sourceId === candidate.sourceId &&
      observation.seriesId === candidate.seriesId &&
      observation.observationDate === candidate.observationDate &&
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

async function main() {
  const executionTimestamp = new Date().toISOString();

  const sourceRegistry = await readJson(
    SOURCES_FILE,
    "sources.json"
  );

  const current = await readJson(
    OBSERVATIONS_FILE,
    "latest-observations.json"
  );

  const eiaWpsr = await readJson(
    EIA_WPSR_FILE,
    "eia-wpsr-latest.json"
  );

  const brent = await readJson(
    BRENT_FILE,
    "brent-latest.json"
  );

  if (!Array.isArray(sourceRegistry.sources)) {
    throw new Error("No source registry found.");
  }

  if (!Array.isArray(current.observations)) {
    throw new Error("Invalid observations array.");
  }

  validateAvailableAt(eiaWpsr, executionTimestamp);
  validateAvailableAt(brent, executionTimestamp);

  const eiaCandidate = preserveFirstAvailableAt(
    {
      sourceId: eiaWpsr.sourceId,
      seriesId: eiaWpsr.seriesId,
      observationDate: eiaWpsr.observationDate,
      availableAt: eiaWpsr.availableAt,
      value: eiaWpsr.value,
      unit: eiaWpsr.unit,
      releaseDate: eiaWpsr.releaseDate
    },
    current.observations
  );

  const brentCandidate = preserveFirstAvailableAt(
    {
      sourceId: brent.sourceId,
      seriesId: brent.seriesId,
      observationDate: brent.observationDate,
      availableAt: brent.availableAt,
      value: brent.value,
      unit: brent.unit,
      frequency: brent.frequency
    },
    current.observations
  );

  const newObservations = [
    ...current.observations.filter(
      (observation) =>
        observation.sourceId !== eiaCandidate.sourceId &&
        observation.sourceId !== brentCandidate.sourceId
    ),
    eiaCandidate,
    brentCandidate
  ];

  const observationsChanged =
    JSON.stringify(current.observations) !==
    JSON.stringify(newObservations);

  if (!observationsChanged) {
    console.log("HESI observation refresh");
    console.log("------------------------");
    console.log("No new usable observations.");
    console.log("Existing observations retained unchanged.");
    console.log("Original AvailableAt timestamps preserved.");
    return;
  }

  const output = {
    ...current,
    updatedAt: executionTimestamp,
    executionTimestamp,
    observations: newObservations,
    notes: current.notes
  };

  await writeFile(
    OBSERVATIONS_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("HESI observation refresh");
  console.log("------------------------");
  console.log(`Execution timestamp: ${executionTimestamp}`);
  console.log(
    `Registered sources: ${sourceRegistry.sources.length}`
  );
  console.log(
    `Stored observations: ${output.observations.length}`
  );
  console.log("AvailableAt rule: ENABLED");
  console.log("Original AvailableAt preserved for unchanged data.");
  console.log("No observations were invented or backfilled.");
}

main().catch((error) => {
  console.error("Observation refresh failed:");
  console.error(error);
  process.exit(1);
});

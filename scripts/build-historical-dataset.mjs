import { readFile, writeFile } from "node:fs/promises";

const HISTORICAL_DATASET_FILE = new URL(
  "../data/historical-dataset.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/point-in-time-backtest.json",
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

function parseTimestamp(value, label) {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    throw new Error(`Invalid timestamp: ${label}`);
  }

  return time;
}

function observationKey(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

function compareByAvailableAt(a, b) {
  const availableDifference =
    parseTimestamp(
      a.availableAt,
      `${a.sourceId} availableAt`
    ) -
    parseTimestamp(
      b.availableAt,
      `${b.sourceId} availableAt`
    );

  if (availableDifference !== 0) {
    return availableDifference;
  }

  const observationDifference =
    parseTimestamp(
      a.observationDate,
      `${a.sourceId} observationDate`
    ) -
    parseTimestamp(
      b.observationDate,
      `${b.sourceId} observationDate`
    );

  if (observationDifference !== 0) {
    return observationDifference;
  }

  return observationKey(a).localeCompare(
    observationKey(b)
  );
}

function utcDayStart(timestamp) {
  const date = new Date(timestamp);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function nextUtcDayStart(timestamp) {
  return utcDayStart(timestamp) + 24 * 60 * 60 * 1000;
}

async function main() {
  const buildTimestamp = new Date().toISOString();

  const dataset = await readJson(
    HISTORICAL_DATASET_FILE,
    "historical-dataset.json"
  );

  if (
    dataset.status !==
    "RESEARCH_DATASET_NOT_CALIBRATED"
  ) {
    throw new Error(
      "Historical dataset has an unexpected status."
    );
  }

  if (dataset.leakageProtection !== "ENABLED") {
    throw new Error(
      "Historical dataset leakage protection is not enabled."
    );
  }

  if (!Array.isArray(dataset.observations)) {
    throw new Error(
      "Historical dataset observations array is missing."
    );
  }

  if (dataset.observations.length === 0) {
    throw new Error(
      "Historical dataset contains no observations."
    );
  }

  const seen = new Set();
  const observations = [];

  for (const observation of dataset.observations) {
    if (!observation.sourceId) {
      throw new Error(
        "Historical observation has no sourceId."
      );
    }

    if (!observation.seriesId) {
      throw new Error(
        `${observation.sourceId} has no seriesId.`
      );
    }

    if (!observation.observationDate) {
      throw new Error(
        `${observation.sourceId} has no observationDate.`
      );
    }

    if (!observation.availableAt) {
      throw new Error(
        `${observation.sourceId} has no AvailableAt.`
      );
    }

    if (
      typeof observation.value !== "number" ||
      !Number.isFinite(observation.value)
    ) {
      throw new Error(
        `${observation.sourceId} has an invalid value.`
      );
    }

    const observationTime = parseTimestamp(
      observation.observationDate,
      `${observation.sourceId} observationDate`
    );

    const availableTime = parseTimestamp(
      observation.availableAt,
      `${observation.sourceId} availableAt`
    );

    if (availableTime < observationTime) {
      throw new Error(
        `${observation.sourceId} has AvailableAt before observationDate.`
      );
    }

    const key = observationKey(observation);

    if (seen.has(key)) {
      throw new Error(
        `Duplicate historical observation: ${key}`
      );
    }

    seen.add(key);

    observations.push({
      ...observation,
      _availableTime: availableTime
    });
  }

  observations.sort(compareByAvailableAt);

  /*
   * A point-in-time snapshot represents the information
   * that could legally have been used at the START of a UTC day.
   *
   * Therefore an observation is eligible only when:
   *
   *     availableAt < snapshotAt
   *
   * This strict inequality is intentional.
   *
   * Example:
   * availableAt = 2011-04-13T23:59:59.999Z
   * first eligible snapshot =
   * 2011-04-14T00:00:00.000Z
   *
   * This preserves the conservative ALFRED convention.
   */

  const firstAvailableTime = Math.min(
    ...observations.map(
      (observation) => observation._availableTime
    )
  );

  const lastAvailableTime = Math.max(
    ...observations.map(
      (observation) => observation._availableTime
    )
  );

  const firstSnapshotTime =
    nextUtcDayStart(firstAvailableTime);

  const finalSnapshotTime =
    nextUtcDayStart(lastAvailableTime);

  const sourceIds = [
    ...new Set(
      observations.map(
        (observation) => observation.sourceId
      )
    )
  ].sort();

  const snapshots = [];

  let eligibleIndex = 0;

  const latestBySeries = new Map();

  for (
    let snapshotTime = firstSnapshotTime;
    snapshotTime <= finalSnapshotTime;
    snapshotTime += 24 * 60 * 60 * 1000
  ) {
    while (
      eligibleIndex < observations.length &&
      observations[eligibleIndex]._availableTime <
        snapshotTime
    ) {
      const observation =
        observations[eligibleIndex];

      const seriesKey =
        `${observation.sourceId}|${observation.seriesId}`;

      const existing =
        latestBySeries.get(seriesKey);

      if (
        !existing ||
        parseTimestamp(
          observation.observationDate,
          `${observation.sourceId} observationDate`
        ) >
          parseTimestamp(
            existing.observationDate,
            `${existing.sourceId} observationDate`
          ) ||
        (
          observation.observationDate ===
            existing.observationDate &&
          observation._availableTime >
            existing._availableTime
        )
      ) {
        latestBySeries.set(
          seriesKey,
          observation
        );
      }

      eligibleIndex += 1;
    }

    const latestObservations = [
      ...latestBySeries.values()
    ]
      .map((observation) => {
        const {
          _availableTime,
          ...cleanObservation
        } = observation;

        return cleanObservation;
      })
      .sort((a, b) => {
        const sourceDifference =
          a.sourceId.localeCompare(b.sourceId);

        if (sourceDifference !== 0) {
          return sourceDifference;
        }

        return a.seriesId.localeCompare(
          b.seriesId
        );
      });

    const sourceCoverage = {};

    for (const sourceId of sourceIds) {
      sourceCoverage[sourceId] =
        latestObservations.some(
          (observation) =>
            observation.sourceId === sourceId
        );
    }

    snapshots.push({
      snapshotAt:
        new Date(snapshotTime).toISOString(),

      eligibilityRule:
        "availableAt < snapshotAt",

      eligibleObservationCount:
        eligibleIndex,

      latestObservationCount:
        latestObservations.length,

      sourceCoverage,

      latestObservations
    });
  }

  /*
   * Structural leakage audit.
   *
   * Every observation exposed inside every snapshot must
   * have been available strictly before that snapshot.
   */

  let leakageViolations = 0;

  for (const snapshot of snapshots) {
    const snapshotTime =
      parseTimestamp(
        snapshot.snapshotAt,
        "snapshotAt"
      );

    for (
      const observation of snapshot.latestObservations
    ) {
      const availableTime =
        parseTimestamp(
          observation.availableAt,
          `${observation.sourceId} availableAt`
        );

      if (availableTime >= snapshotTime) {
        leakageViolations += 1;
      }
    }
  }

  if (leakageViolations !== 0) {
    throw new Error(
      `Point-in-time leakage audit failed: ${leakageViolations} violation(s).`
    );
  }

  const output = {
    schemaVersion: "1.0",

    status:
      "POINT_IN_TIME_BACKTEST_DATASET_NOT_CALIBRATED",

    buildTimestamp,

    sourceDataset: {
      status: dataset.status,
      buildTimestamp:
        dataset.buildTimestamp || null,
      observationCount:
        dataset.observations.length,
      leakageProtection:
        dataset.leakageProtection
    },

    pointInTimePolicy: {
      enabled: true,

      snapshotTimezone: "UTC",

      snapshotMoment:
        "START_OF_UTC_DAY",

      eligibilityRule:
        "An observation is eligible only when availableAt is strictly earlier than snapshotAt.",

      sameTimestampEligibility: false,

      availableAtReconstruction: false,

      availableAtBackwardShift: false,

      futureInformationAllowed: false
    },

    summary: {
      sourceObservationCount:
        observations.length,

      snapshotCount:
        snapshots.length,

      firstSnapshotAt:
        snapshots.length > 0
          ? snapshots[0].snapshotAt
          : null,

      lastSnapshotAt:
        snapshots.length > 0
          ? snapshots[
              snapshots.length - 1
            ].snapshotAt
          : null,

      sources: sourceIds,

      leakageViolations
    },

    snapshots,

    safeguards: {
      historicalDatasetModified: false,
      calibrationPerformed: false,
      modelWeightsModified: false,
      thresholdsModified: false,
      forecastModelTrained: false,
      officialHesiModified: false,
      dashboardOfficialHesiModified: false
    },

    calibrationReadiness: {
      ready: false,

      reason:
        "Point-in-time dataset construction establishes chronological information eligibility only. It does not establish calibration sufficiency, predictive validity or out-of-sample performance."
    },

    interpretationLimits: [
      "Each snapshot contains only observations whose AvailableAt is strictly earlier than the snapshot timestamp.",
      "The snapshot stores the latest eligible observation for each sourceId and seriesId.",
      "The builder does not reconstruct, move backward or invent AvailableAt timestamps.",
      "ALFRED date-level availability remains subject to the previously approved conservative end-of-day UTC research convention.",
      "Passing the leakage audit validates the implemented eligibility rule; it does not independently prove the real-world historical accuracy of provider availability metadata.",
      "No model calibration, weight optimization, threshold optimization or forecast training is performed by this builder.",
      "This artifact must not be interpreted as evidence that the experimental HESI is scientifically validated.",
      "Official HESI remains unchanged."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "HESI point-in-time backtest dataset"
  );
  console.log(
    "-----------------------------------"
  );
  console.log(
    `Build timestamp: ${buildTimestamp}`
  );
  console.log(
    `Source observations: ${observations.length}`
  );
  console.log(
    `Snapshots: ${snapshots.length}`
  );
  console.log(
    `First snapshot: ${output.summary.firstSnapshotAt}`
  );
  console.log(
    `Last snapshot: ${output.summary.lastSnapshotAt}`
  );
  console.log(
    `Sources: ${sourceIds.join(", ")}`
  );
  console.log(
    `Leakage violations: ${leakageViolations}`
  );
  console.log(
    "Calibration performed: NO"
  );
  console.log(
    "Model weights modified: NO"
  );
  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "Point-in-time backtest dataset build failed:"
  );
  console.error(error);
  process.exit(1);
});

import { readFile, writeFile } from "node:fs/promises";

const OBSERVATIONS_FILE = new URL(
  "../data/latest-observations.json",
  import.meta.url
);

const PHYSICAL_EVENTS_FILE = new URL(
  "../data/physical-events.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
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

function clamp(value, min = 0, max = 100) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;

  return (
    Math.round(value * factor) /
    factor
  );
}

function requireObservation(
  observations,
  sourceId
) {
  const observation =
    observations.find(
      (item) =>
        item.sourceId === sourceId
    );

  if (!observation) {
    throw new Error(
      `Missing required observation: ${sourceId}`
    );
  }

  return observation;
}

async function main() {
  const executionTimestamp =
    new Date().toISOString();

  const latest = await readJson(
    OBSERVATIONS_FILE,
    "latest-observations.json"
  );

  const physicalEvents = await readJson(
    PHYSICAL_EVENTS_FILE,
    "physical-events.json"
  );

  if (!Array.isArray(latest.observations)) {
    throw new Error(
      "Invalid observations array."
    );
  }

  if (!Array.isArray(physicalEvents.events)) {
    throw new Error(
      "Invalid physical events array."
    );
  }

  const brent = requireObservation(
    latest.observations,
    "brent_market"
  );

  const cftc = requireObservation(
    latest.observations,
    "cftc_cot"
  );

  if (
    typeof brent.value !== "number" ||
    !Number.isFinite(brent.value) ||
    brent.value <= 0
  ) {
    throw new Error(
      "Invalid Brent observation."
    );
  }

  if (
    typeof cftc.managedMoneyNet !==
      "number" ||
    !Number.isFinite(
      cftc.managedMoneyNet
    )
  ) {
    throw new Error(
      "Invalid CFTC Managed Money observation."
    );
  }

  /*
   * EXPERIMENTAL MARKET NORMALIZATION
   *
   * Transparent provisional anchors.
   * These are NOT trained model parameters.
   *
   * Brent:
   *   50 USD/bbl -> stress 0
   *   150 USD/bbl -> stress 100
   *
   * CFTC Managed Money Net:
   *   -200,000 -> stress 0
   *   +200,000 -> stress 100
   */

  const brentStress = clamp(
    ((brent.value - 50) / 100) * 100
  );

  const cftcStress = clamp(
    ((cftc.managedMoneyNet + 200000) /
      400000) *
      100
  );

  /*
   * Experimental Market Stress
   *
   * 70% Brent
   * 30% CFTC positioning
   *
   * NOT promoted to official HESI.
   */

  const marketStressExperimental =
    clamp(
      0.7 * brentStress +
      0.3 * cftcStress
    );

  /*
   * EXPERIMENTAL PHYSICAL LAYER
   *
   * IMPORTANT:
   *
   * No validated events DOES NOT mean
   * Physical Stress = 0.
   *
   * Until validated physical events exist
   * and a defensible scoring methodology
   * has been established, Physical Stress
   * remains explicitly non-computable.
   */

  const validatedPhysicalEventCount =
    physicalEvents.events.length;

  const physicalStressStatus =
    validatedPhysicalEventCount === 0
      ? "NOT_COMPUTABLE_NO_VALIDATED_EVENTS"
      : "NOT_COMPUTABLE_SCORING_NOT_CALIBRATED";

  const physicalStressExperimental = null;

  /*
   * Effective HESI cannot be calculated
   * safely until both Market Stress and
   * Physical Stress have validated,
   * leakage-safe methodologies.
   */

  const hesiEffectiveExperimental = null;

  const asOf =
    [
      brent.observationDate,
      cftc.observationDate
    ]
      .sort()
      .at(-1);

  const output = {
    schemaVersion: "1.0",

    executionTimestamp,

    asOf,

    status:
      "EXPERIMENTAL_NOT_PROMOTED",

    availableAtProtection:
      "ENABLED",

    inputs: {
      brent: {
        observationDate:
          brent.observationDate,
        availableAt:
          brent.availableAt,
        value:
          brent.value,
        unit:
          brent.unit
      },

      cftc: {
        observationDate:
          cftc.observationDate,
        availableAt:
          cftc.availableAt,
        managedMoneyLong:
          cftc.managedMoneyLong,
        managedMoneyShort:
          cftc.managedMoneyShort,
        managedMoneySpreading:
          cftc.managedMoneySpreading,
        managedMoneyNet:
          cftc.managedMoneyNet,
        unit:
          cftc.unit
      },

      physicalEvents: {
        status:
          physicalEvents.status,
        validatedEventCount:
          validatedPhysicalEventCount
      }
    },

    components: {
      brentStress:
        round(brentStress),

      cftcPositioningStress:
        round(cftcStress)
    },

    marketStressExperimental:
      round(
        marketStressExperimental
      ),

    physicalStress: {
      status:
        physicalStressStatus,

      validatedEventCount:
        validatedPhysicalEventCount,

      physicalStressExperimental:
        physicalStressExperimental
    },

    hesiEffectiveExperimental:
      hesiEffectiveExperimental,

    weights: {
      brent: 0.7,
      cftc: 0.3
    },

    promotion: {
      dashboardUpdated: false,
      officialHesiUpdated: false
    },

    methodologyNote:
      "Experimental HESI computation. Market Stress uses provisional scaling anchors and weights that have not yet been historically calibrated out-of-sample. Physical Stress remains non-computable until validated physical events and a defensible scoring methodology are available. Missing physical events must never be interpreted as zero physical stress. No experimental result may replace the official dashboard HESI until leakage-safe historical validation is completed."
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
    "HESI experimental computation"
  );
  console.log(
    "-----------------------------"
  );

  console.log(
    `Brent: ${brent.value}`
  );

  console.log(
    `CFTC Managed Money Net: ${cftc.managedMoneyNet}`
  );

  console.log(
    `Brent stress: ${round(brentStress)}`
  );

  console.log(
    `CFTC stress: ${round(cftcStress)}`
  );

  console.log(
    `Experimental Market Stress: ${round(
      marketStressExperimental
    )}`
  );

  console.log(
    `Validated physical events: ${validatedPhysicalEventCount}`
  );

  console.log(
    `Physical Stress status: ${physicalStressStatus}`
  );

  console.log(
    "Experimental Physical Stress: NOT COMPUTED"
  );

  console.log(
    "Experimental HESI Effective: NOT COMPUTED"
  );

  console.log(
    "Official dashboard HESI modified: NO"
  );

  console.log(
    "Status: EXPERIMENTAL_NOT_PROMOTED"
  );
}

main().catch((error) => {
  console.error(
    "HESI computation failed:"
  );
  console.error(error);
  process.exit(1);
});

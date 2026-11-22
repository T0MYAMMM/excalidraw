/* eslint-disable no-console -- CLI script that reports to stdout */
// Links finished materials to the AWS service sections they mention.
// - An element that names exactly one service links straight to it.
// - Under each finished material, a row of Violet-1 chips (one per service
//   mentioned, in reading order) links to each service section.
// A material is "finished" when it has no "- Template" heading left.
// Safe to rerun: previous chips are replaced, links are recomputed.
// Usage: node link_services.mjs [--dry-run]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = import.meta.dirname;
const M = resolve(HERE, "../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { addElements } = await import(join(M, "elements.mjs"));

const TARGET = "aws-data-engineer-associate";
const BASE_URL = "http://localhost:3000/";
const dryRun = process.argv.includes("--dry-run");
// chip list geometry (right of each material, up to CHIP.columns columns)
const CHIP = { offset: 30, top: 30, w: 190, h: 28, gap: 6, columns: 2 };
const CHIP_AREA =
  CHIP.offset + CHIP.columns * CHIP.w + (CHIP.columns - 1) * CHIP.gap * 2 + 30;

// service section title (after "- ") -> [short chip name, patterns]
const SERVICES = [
  [
    "Amazon Kinesis Data Streams (KDS)",
    "Kinesis Data Streams",
    [/Kinesis(?!\s*(Data\s*)?Firehose)/, /\bKDS\b/],
  ],
  ["Amazon Data Firehose", "Firehose", [/Firehose/]],
  ["Amazon MSK", "MSK", [/\bMSK\b/, /\bKafka\b/]],
  ["Amazon Managed Service for Apache Flink", "Flink", [/Flink/]],
  ["AWS Data Migration Service (DMS)", "DMS", [/\bDMS\b/]],
  ["Amazon AppFlow", "AppFlow", [/AppFlow/]],
  ["AWS DataSync", "DataSync", [/DataSync/]],
  ["AWS Transfer Family", "Transfer Family", [/Transfer\s+Family/]],
  ["AWS Snow Family", "Snow Family", [/Snowball|Snow\s+Family/]],
  ["AWS Data Exchange", "Data Exchange", [/Data\s+Exchange/]],
  [
    "AWS Glue Data Catalog & Crawlers",
    "Glue Data Catalog",
    [/Glue\s+(Data\s+)?Catalog/, /\bcrawlers?\b/i],
  ],
  [
    "AWS Glue DataBrew & Data Quality",
    "DataBrew",
    [/DataBrew/, /Glue\s+Data\s+Quality/],
  ],
  [
    "AWS Glue ETL",
    "Glue ETL",
    [/\bGlue\b(?!\s+(Data\s+)?Catalog|\s+DataBrew|\s+Data\s+Quality)/],
  ],
  ["Amazon EMR", "EMR", [/\bEMR\b/]],
  ["AWS Lambda", "Lambda", [/\b[Ll]ambda\b(?!\s+architecture)/]],
  ["AWS Step Functions", "Step Functions", [/Step\s+Functions/]],
  ["Amazon MWAA", "MWAA", [/\bMWAA\b/]],
  ["Amazon EventBridge", "EventBridge", [/EventBridge/]],
  ["Amazon SNS & Amazon SQS", "SNS & SQS", [/\bSNS\b/, /\bSQS\b/]],
  ["Amazon Bedrock", "Bedrock", [/Bedrock/]],
  ["Amazon Redshift", "Redshift", [/Redshift/]],
  [
    "Amazon S3 Tables & Apache Iceberg",
    "S3 Tables & Iceberg",
    [/S3\s+Tables/, /Iceberg/],
  ],
  ["Amazon S3", "S3", [/\bS3\b(?!\s+Tables)/]],
  ["Amazon DynamoDB", "DynamoDB", [/DynamoDB/]],
  ["Amazon RDS & Aurora", "RDS & Aurora", [/\bRDS\b/, /Aurora/]],
  ["Amazon Athena", "Athena", [/Athena/]],
  ["Amazon OpenSearch Service", "OpenSearch", [/OpenSearch/]],
  ["Amazon QuickSight", "QuickSight", [/QuickSight/]],
  ["Amazon SageMaker Unified Studio & Catalog", "SageMaker", [/SageMaker/]],
  ["AWS IAM", "IAM", [/\bIAM\b/]],
  ["AWS Lake Formation", "Lake Formation", [/Lake\s*Formation/]],
  ["AWS KMS", "KMS", [/\bKMS\b/]],
  [
    "AWS Secrets Manager & Parameter Store",
    "Secrets Manager",
    [/Secrets\s+Manager|Parameter\s+Store/],
  ],
  ["Amazon Macie", "Macie", [/Macie/]],
  ["AWS CloudTrail", "CloudTrail", [/Cloud\s*Trail/]],
  ["Amazon CloudWatch", "CloudWatch", [/CloudWatch/]],
  ["AWS Config", "AWS Config", [/AWS\s+Config/]],
  [
    "AWS CloudFormation & AWS CDK",
    "CloudFormation & CDK",
    [/CloudFormation|\bCDK\b/],
  ],
];

/** Services named in `text`, in order of first appearance. */
export const mentions = (text) =>
  SERVICES.map(([title, short, pats]) => {
    const idx = Math.min(
      ...pats.map((p) => text.search(p)).filter((i) => i >= 0),
      Infinity,
    );
    return { title, short, idx };
  })
    .filter((s) => s.idx !== Infinity)
    .sort((a, b) => a.idx - b.idx);

const link = (scene) => {
  const live = scene.elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const members = (g) => live.filter((e) => (e.groupIds ?? []).includes(g));
  const touch = (e) => {
    e.version = (e.version ?? 1) + 1;
    e.versionNonce = Math.floor(Math.random() * 2 ** 31);
    e.updated = Date.now();
  };

  // service section boxes by title
  const sectionBox = new Map();
  for (const b of live.filter(
    (e) =>
      e.type === "rectangle" &&
      e.backgroundColor.toLowerCase() === "#f3f0ff" &&
      e.width > 600 &&
      !e.id.startsWith("legend-"),
  )) {
    const head = members(b.groupIds.at(-1))
      .filter(
        (e) => e.type === "text" && !e.containerId && e.text.startsWith("- "),
      )
      .sort((a, c) => a.y - c.y || a.x - c.x)[0];
    sectionBox.set(head.text.slice(2).trim(), b);
  }
  const matRight = Math.max(
    ...live
      .filter(
        (e) =>
          e.type === "rectangle" &&
          e.backgroundColor.toLowerCase() === "#fff4e6" &&
          e.width > 1000 &&
          !e.id.startsWith("legend-"),
      )
      .map((e) => e.x + e.width),
  );
  const svcLeft = Math.min(...[...sectionBox.values()].map((b) => b.x));
  const needLeft = matRight + CHIP_AREA;
  let servicesShifted = 0;
  if (svcLeft < needLeft) {
    servicesShifted = Math.round(needLeft - svcLeft);
    for (const b of sectionBox.values()) {
      for (const e of members(b.groupIds.at(-1))) {
        e.x += servicesShifted;
        touch(e);
      }
    }
  }
  const href = (title) => `${BASE_URL}?element=${sectionBox.get(title).id}`;

  // every material must be a group (its chips live in that group); stop
  // before deleting anything if one was ungrouped for editing
  const ungrouped = live
    .filter(
      (e) =>
        e.type === "rectangle" &&
        e.backgroundColor.toLowerCase() === "#fff4e6" &&
        e.width > 1000 &&
        !e.id.startsWith("legend-"),
    )
    .sort((a, b) => a.y - b.y)
    .map((b, i) => (b.groupIds?.length ? null : i + 1))
    .filter(Boolean);
  if (ungrouped.length) {
    throw new Error(
      `material(s) ${ungrouped.join(
        ", ",
      )} are not grouped; regroup them first (nothing was changed)`,
    );
  }

  // drop chips from a previous run. Ids can change when the browser saves,
  // so chips are recognised by what they are: a "↗ …" box linking to a
  // service section, the "Services:" label, and their bound labels; plus any
  // "↗ …" text whose box is gone (left over from older runs).
  const isChipBox = (e) =>
    e.type === "rectangle" &&
    e.backgroundColor.toLowerCase() === "#f3f0ff" &&
    (e.link ?? "").includes("?element=") &&
    (e.boundElements ?? []).some((b) => byId.get(b.id)?.text?.startsWith("↗"));
  const doomed = new Set();
  for (const e of live) {
    if (
      e.id.startsWith("svc-chip-") ||
      isChipBox(e) ||
      (e.type === "text" && e.text === "Services:")
    ) {
      doomed.add(e.id);
    }
    if (
      e.type === "text" &&
      e.text.startsWith("↗") &&
      (!e.containerId || !byId.has(e.containerId))
    ) {
      doomed.add(e.id); // orphaned chip label
    }
  }
  for (const e of live) {
    if (e.containerId && doomed.has(e.containerId)) {
      doomed.add(e.id); // a chip's own label
    }
  }
  for (const id of doomed) {
    byId.get(id).isDeleted = true;
    touch(byId.get(id));
  }

  const mats = live
    .filter(
      (e) =>
        e.type === "rectangle" &&
        e.backgroundColor.toLowerCase() === "#fff4e6" &&
        e.width > 1000 &&
        !e.id.startsWith("legend-"),
    )
    .sort((a, b) => a.y - b.y);
  const report = [];
  mats.forEach((box, row) => {
    const g = box.groupIds.at(-1);
    const els = members(g).filter(
      (e) => !e.isDeleted && !e.id.startsWith("mat-title-"), // skips chips being replaced
    );
    if (els.some((e) => e.type === "text" && e.text.trim() === "- Template")) {
      return; // not finished yet
    }
    const texts = els
      .filter((e) => e.type === "text")
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const seen = new Map();
    let direct = 0;
    for (const t of texts) {
      const found = mentions(t.text).filter((s) => sectionBox.has(s.title));
      found.forEach((s) => seen.has(s.title) || seen.set(s.title, s));
      if (found.length === 1) {
        const target = t.containerId ? byId.get(t.containerId) : t; // link the card, not its label
        if (target && target.link !== href(found[0].title)) {
          target.link = href(found[0].title);
          touch(target);
          direct++;
        }
      }
    }
    // chips to the right of the material, listed top to bottom
    const chips = [];
    const x0 = box.x + box.width + CHIP.offset;
    const inputs = [
      {
        type: "text",
        id: `svc-chip-${row + 1}-label`,
        x: x0,
        y: box.y,
        text: "Services:",
        fontSize: 14,
      },
    ];
    const perColumn = Math.floor(
      (box.height - CHIP.top + CHIP.gap) / (CHIP.h + CHIP.gap),
    );
    [...seen.values()].forEach((s, k) => {
      const col = Math.floor(k / perColumn);
      const pos = k % perColumn;
      inputs.push({
        type: "rectangle",
        id: `svc-chip-${row + 1}-${k + 1}`,
        x: x0 + col * (CHIP.w + CHIP.gap * 2),
        y: box.y + CHIP.top + pos * (CHIP.h + CHIP.gap),
        width: CHIP.w,
        height: CHIP.h,
        backgroundColor: "#f3f0ff",
        strokeWidth: 1,
        roughness: 0,
        label: { text: `↗ ${s.short}`, fontSize: 12 },
      });
    });
    addElements(chips, inputs);
    for (const c of chips) {
      c.groupIds = [g]; // move with the material
      if (c.type === "rectangle") {
        const s = [...seen.values()][Number(c.id.split("-").at(-1)) - 1];
        c.link = href(s.title);
      }
    }
    scene.elements.push(...chips);
    report.push({
      row: row + 1,
      direct_links: direct,
      chips: seen.size,
      services: [...seen.values()].map((s) => s.short),
    });
  });
  return { services_shifted_px: servicesShifted, rows: report };
};

if (dryRun) {
  const scene = JSON.parse(
    readFileSync(`${process.env.HOME}/drawings/${TARGET}.excalidraw`, "utf8"),
  );
  console.log(JSON.stringify(link(scene), null, 1));
} else {
  console.log(
    JSON.stringify(
      await createClient("http://localhost:3000").modify(TARGET, link),
      null,
      1,
    ),
  );
}

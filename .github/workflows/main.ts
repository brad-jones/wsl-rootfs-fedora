import { outdent } from "@cspotcode/outdent";
import $ from "@david/dax";
import * as fs from "@std/fs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import ky from "ky";
import { z } from "zod";
dayjs.extend(utc);

const latestFedora = z.object({ Tags: z.array(z.string()) })
  .parse(await $`skopeo list-tags docker://docker.io/fedora`.json())
  .Tags.filter((_) => _.match(/^\d+$/))
  .reverse()[0];

$.log(`Latest Fedora: ${latestFedora}`);

const latestDeno = z.object({ Tags: z.array(z.string()) })
  .parse(await $`skopeo list-tags docker://docker.io/denoland/deno`.json())
  .Tags.filter((_) => _.match(/^bin-\d+\.\d+\.\d+$/))
  .reverse()[0].replace("bin-", "");

$.log(`Latest Deno: ${latestDeno}`);

const latestHansel = z.object({ Tags: z.array(z.string()) })
  .parse(await $`skopeo list-tags docker://ghcr.io/shopify/hansel`.json())
  .Tags.filter((_) => _.match(/^\d+\.\d+\.\d+$/))
  .reverse()[0];

$.log(`Latest Hansel: ${latestHansel}`);

$.log(`Building...`);
await Deno.mkdir("dist");
const rootfsFileName = `wsl-rootfs-fedora_${latestFedora}.tar.gz`;
await $`docker buildx b
  --sbom=true --provenance=true
  --build-arg ${`FEDORA_VERSION=${latestFedora}`}
  --build-arg ${`DENO_VERSION=-${latestDeno}`}
  --build-arg ${`HANSEL_VERSION=${latestHansel}`}
  --output type=tar ./src | gzip >./dist/${rootfsFileName}
`;

if (!await fs.exists(`./dist/${rootfsFileName}`) || (await Deno.stat(`./dist/${rootfsFileName}`)).size === 0) {
  Deno.exit(-1);
}

$.log(`Comparing sbom to last sbom...`);
await $`tar -xf ./dist/${rootfsFileName} provenance.json sbom.spdx.json`;

const sbomSchema = z.object({
  predicate: z.object({
    packages: z.array(z.object({
      name: z.string(),
      versionInfo: z.string().optional(),
    })),
  }),
});

const filterPackages = (sbom: z.infer<typeof sbomSchema>) =>
  sbom.predicate.packages
    .filter((_) => typeof _.versionInfo === "string")
    .map((_) => ({ name: _.name, version: _.versionInfo! }));

const nextSbom = filterPackages(sbomSchema.parse(JSON.parse(await Deno.readTextFile("./dist/sbom.spdx.json"))));

const currentSbomUrl = z.object({ assets: z.array(z.object({ url: z.string().url() })) })
  .parse(await $`gh release view --json assets`.json())
  .assets.find((_) => _.url.endsWith("sbom.spdx.json"))?.url;

const publish = async (notes: string) => {
  const releaseTitle = `Fedora ${latestFedora} - ${dayjs.utc().format("YYYYMMDD")}`;
  const releaseTag = `${latestFedora}-${dayjs.utc().format("YYYYMMDD")}`;
  const releaseNotesFile = "./dist/notes.md";
  await Deno.writeTextFile(releaseNotesFile, notes);
  await $`gh release create ${releaseTag}
    --title ${releaseTitle}
    -F ${releaseNotesFile}
    ./dist/${rootfsFileName}
    ./dist/provenance.json
    ./dist/sbom.spdx.json
  `;
};

if (!currentSbomUrl) {
  $.log(`No previous release, publishing...`);
  await publish(outdent`
    # Packages

    ## Initial
    ${nextSbom.map(({ name, version }) => `- ${name}: ${version}\n`)}
  `);
  Deno.exit(0);
}

const currentSbom = filterPackages(sbomSchema.parse(await ky.get(currentSbomUrl).json()));

const diff = {
  added: nextSbom.filter((next) => currentSbom.find((current) => current.name === next.name) === undefined),
  updated: nextSbom
    .filter((next) => currentSbom.find((current) => current.name === next.name && current.version !== next.version))
    .map((next) => ({
      name: next.name,
      newV: next.version,
      oldV: currentSbom.find((current) => current.name === next.name)?.version,
    })),
  deleted: currentSbom.filter((current) => nextSbom.find((next) => next.name === current.name) === undefined),
};

if (diff.added.length === 0 && diff.updated.length === 0 && diff.deleted.length === 0) {
  $.log(`No difference between the latest release & this new build, finish up...`);
  await Deno.remove("./dist", { recursive: true });
  Deno.exit(0);
}

$.log(`Publishing...`);
await publish(outdent`
  # Packages
  ${diff.added.length > 0 ? `## Added\n${diff.added.map(({ name, version }) => `- ${name}: ${version}\n`)}` : ""}
  ${
  diff.updated.length > 0
    ? `## Updated\n${diff.updated.map(({ name, oldV, newV }) => `- ${name}: ${oldV} => ${newV}\n`)}`
    : ""
}
  ${diff.deleted.length > 0 ? `## Deleted\n${diff.deleted.map(({ name, version }) => `- ${name}: ${version}\n`)}` : ""}
`);

import { outdent } from "@cspotcode/outdent";
import $ from "@david/dax";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import ky from "ky";
import { z } from "zod";
dayjs.extend(utc);

const latestFedora = z.object({ Tags: z.array(z.string()) })
  .parse(await $`skopeo list-tags docker://docker.io/fedora`.json())
  .Tags.filter((_) => _.match(/^\d+$/))
  .reverse()[1]; // NB: Fedora n = rawhide & n-1 = stable

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

$.log(`Building rootfs...`);
await Deno.mkdir("dist");
let rootfsFileName = `wsl-rootfs-fedora_${latestFedora}.tar`;
await $`docker buildx b
  --sbom=true --provenance=true
  --build-arg ${`FEDORA_VERSION=${latestFedora}`}
  --build-arg ${`DENO_VERSION=-${latestDeno}`}
  --build-arg ${`HANSEL_VERSION=${latestHansel}`}
  --output type=tar,dest=./dist/${rootfsFileName} ./src
`;

$.log(`Comparing sbom to last sbom...`);
await $`tar -xf ${rootfsFileName} provenance.json sbom.spdx.json`.cwd("./dist");

const sbomSchema = z.object({
  predicate: z.object({
    packages: z.array(z.object({
      name: z.string(),
      versionInfo: z.string().optional(),
    })),
  }),
});

const filterPackages = (sbom: z.infer<typeof sbomSchema>) =>
  Object.entries(
    sbom.predicate.packages
      .filter((_) => typeof _.versionInfo === "string")
      .map((_) => ({ name: _.name, version: _.versionInfo! }))
      .reduce((prev, cur) => {
        if (prev[cur.name]) {
          prev[cur.name] = `${prev[cur.name]},${cur.version}`;
        } else {
          prev[cur.name] = cur.version;
        }
        return prev;
      }, {} as Record<string, string>),
  ).map((_) => ({ name: _[0], version: _[1] }));

const nextCommitSha = Deno.env.get("GITHUB_SHA")!;
const nextSbom = filterPackages(sbomSchema.parse(JSON.parse(await Deno.readTextFile("./dist/sbom.spdx.json"))));

let currentCommitSha: string | undefined = undefined;
let currentSbomUrl: string | undefined | false = undefined;
const result = await $`gh release view --json tagName,assets`.noThrow().captureCombined();
if (result.code !== 0) {
  if (!result.combined.includes("release not found")) {
    throw new Error(`failed to get gh release`);
  } else {
    currentSbomUrl = false;
  }
}
if (currentSbomUrl === undefined) {
  const release = z.object({ tagName: z.string(), assets: z.array(z.object({ url: z.string().url() })) })
    .parse(JSON.parse(result.combined));

  currentSbomUrl = release.assets.find((_) => _.url.endsWith("sbom.spdx.json"))?.url;
  currentCommitSha = z.object({ object: z.object({ sha: z.string() }) }).parse(
    await $`gh api ${`repos/${Deno.env.get("GITHUB_REPOSITORY")!}/git/ref/tags/${release.tagName}`}`.json(),
  ).object.sha;
}

const publish = async (notes: string) => {
  const releaseTitle = `Fedora ${latestFedora} - ${dayjs.utc().format("YYYYMMDD")} (sha: ${
    nextCommitSha.substring(0, 8)
  })`;
  const releaseTag = `${latestFedora}-${dayjs.utc().format("YYYYMMDD")}-${nextCommitSha.substring(0, 8)}`;
  const releaseNotesFile = "./dist/notes.md";
  await Deno.writeTextFile(releaseNotesFile, notes);

  $.log(`Compressing rootfs...`);
  await $`gzip ./dist/${rootfsFileName}`;
  rootfsFileName = `${rootfsFileName}.gz`;

  await $`gh release create ${releaseTag}
    --title ${releaseTitle}
    -F ${releaseNotesFile}
    ./dist/${rootfsFileName}
    ./dist/provenance.json
    ./dist/sbom.spdx.json
  `;
  await Deno.remove("./dist/notes.md");
};

if (!currentSbomUrl) {
  $.log(`No previous release, publishing...`);
  await publish(outdent`
    ## Packages

    ### Initial
    ${nextSbom.map(({ name, version }) => `- ${name}: ${version}`).join("\n")}
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

if (
  diff.added.length === 0 && diff.updated.length === 0 && diff.deleted.length === 0 &&
  currentCommitSha === nextCommitSha
) {
  $.log(`No difference between the latest release & this new build, finishing up...`);
  await Deno.remove("./dist", { recursive: true });
  Deno.exit(0);
}

const publishReason = currentCommitSha !== nextCommitSha ? "a new commit" : "sbom package differences";
$.log(`Publishing because of ${publishReason}...`);

await publish(outdent`
  **Build Changes:** ${
  currentCommitSha !== nextCommitSha
    ? `https://github.com/${Deno.env.get("GITHUB_REPOSITORY")!}/compare/${currentCommitSha}...${nextCommitSha}`
    : "n/a"
}
  ## Packages
  ${
  diff.added.length === 0 && diff.updated.length === 0 && diff.deleted.length === 0
    ? "No changes to installed packages."
    : ""
}
  ${
  diff.added.length > 0 ? `### Added\n${diff.added.map(({ name, version }) => `- ${name}: ${version}`).join("\n")}` : ""
}
  ${
  diff.updated.length > 0
    ? `### Updated\n${diff.updated.map(({ name, oldV, newV }) => `- ${name}: ${oldV} => ${newV}`).join("\n")}`
    : ""
}
  ${
  diff.deleted.length > 0
    ? `### Deleted\n${diff.deleted.map(({ name, version }) => `- ${name}: ${version}`).join("\n")}`
    : ""
}
`);

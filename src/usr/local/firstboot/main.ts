import outdent from "jsr:@cspotcode/outdent@0.8.0";
import $ from "jsr:@david/dax@0.42.0";
import * as fs from "jsr:@std/fs@1.0.6";
import { z } from "npm:zod@3.23.8";

if (await fs.exists("/root/.first-boot") && await Deno.readTextFile("/root/.first-boot") === "complete") {
  await $`gum style
    --foreground "#ed0000" --margin "1 2"
    'First boot has already executed, this script is not idempotent & does not support running a second time.'
  `;
  Deno.exit(-1);
}

const configSchema = z.object({
  skip: z.boolean().optional(),
  firstUser: z.string().default(await $`wslvar USERNAME`.text()),
  setPassword: z.boolean().default(true),
  addToSudoers: z.boolean().default(true),
  enableSystemdLinger: z.boolean().default(true),
  enableSound: z.boolean().default(false),
});

let config = configSchema.parse({});
if (Deno.args[0] === "--config") {
  // Read config from command line
  // Eg: wsl -d fedora -- firstboot --config '{"username": "JohnDoe"}'
  config = configSchema.parse(JSON.parse(Deno.args[1]));
} else {
  // Ask for config interactively
  const prettyName = (await Deno.readTextFile("/etc/os-release"))
    .split("\n").find((_) => _.startsWith("PRETTY_NAME"))?.split("=")[1]
    .replaceAll('"', "")!;

  await $`gum style
    --foreground "#56a4d8"
    --border-foreground "#61a5fa"
    --border double
    --align center
    --width 80
    --margin "1 2"
    --padding "2 4"
    'Welcome to the first boot experience!'
    ${`For: ${prettyName}`}
  `;

  await $`gum format`.stdinText(outdent`
    # Jobs to be done
    - Create first user (unprivileged)
    - Optionally set a password
    - Optionally add the new user to sudoers
    - Optionally enable the users systemd session to linger
    - Optional install pulseaudio to enable sound
  `);

  console.log();

  const result = await $`gum confirm 'Would you like to continue with the first boot experience?'`.noThrow();
  if (result.code !== 0) {
    await Deno.create("/root/.first-boot");
    await $`gum style --foreground "#ed0000" --margin "1 2" --underline 'The first boot experience has been skipped.'`;
    await $`gum format`.stdinText(outdent`
      You will not see this again, unless:
      - You delete the file \`/root/.first-boot\`
      - Or you run the \`firstboot\` command yourself
    `);
    Deno.exit(0);
  }

  config.firstUser = await $.prompt("What username would like for your first user?", { default: config.firstUser });
  config.setPassword = await $.confirm("Would you like to set a password?", { default: config.setPassword });
  config.addToSudoers = await $.confirm("Would you like to give the user the ability to elevate via sudo to root?", {
    default: config.addToSudoers,
  });
  config.enableSystemdLinger = await $.confirm("Would you like the users systemd session to linger?", {
    default: config.enableSystemdLinger,
  });
  config.enableSound = await $.confirm("Would you like to install pulseaudio to enable sound?", {
    default: config.enableSound,
  });
}

const progressMsg = (msg: string) => Deno.stdout.write(new TextEncoder().encode(msg));

await progressMsg(`Creating user ${config.firstUser}... `);
if (config.addToSudoers) {
  await $`useradd -m -G wheel "${config.firstUser}"`;
} else {
  await $`useradd -m "${config.firstUser}"`;
}
await Deno.writeTextFile(
  "/etc/wsl.conf",
  outdent`
    ${await Deno.readTextFile("/etc/wsl.conf")}
    [user]
    default="${config.firstUser}"

  `,
);
await progressMsg(`DONE\n`);

if (config.setPassword) {
  await $.withRetries({
    count: 3,
    delay: "1s",
    action: async () => {
      await $`passwd "${config.firstUser}"`;
    },
  });
} else {
  await progressMsg(`Disabling password... `);
  await $`passwd -d "${config.firstUser}"`.quiet();
  await progressMsg(`DONE\n`);
}

if (config.addToSudoers) {
  await progressMsg(`Adding user to sudoers... `);
  await Deno.writeTextFile(
    "/etc/sudoers.d/wheel",
    `%wheel ALL=(ALL)${config.setPassword ? " " : " NOPASSWD: "}ALL`,
  );
  await progressMsg(`DONE\n`);
}

if (config.enableSystemdLinger) {
  await progressMsg(`Enabling systemd linger... `);
  await $`loginctl enable-linger "${config.firstUser}"`;
  await progressMsg(`DONE\n`);
}

if (config.enableSound) {
  await $`dnf install -y pulseaudio`;
}

await Deno.writeTextFile("/root/.first-boot", "complete");

const vmName = Deno.env.get("WSL_DISTRO_NAME");
if (vmName) {
  await progressMsg(`Bye, Shutting down...`);
  await $`wsl.exe -t ${vmName}`;
}

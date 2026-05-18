#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";

process.env.BIRRJS_CLI = "1";

const program = new Command().name("birrjs").description("CLI for BirrJS billing");

const commandName = process.argv[2];

switch (commandName) {
  case "status": {
    const { statusCommand } = await import("./commands/status");
    program.addCommand(statusCommand);
    break;
  }
  case "push": {
    const { pushCommand } = await import("./commands/push");
    program.addCommand(pushCommand);
    break;
  }
  case "init": {
    const { initCommand } = await import("./commands/init");
    program.addCommand(initCommand);
    break;
  }
  default: {
    const [{ statusCommand }, { pushCommand }, { initCommand }] = await Promise.all([
      import("./commands/status"),
      import("./commands/push"),
      import("./commands/init"),
    ]);
    program.addCommand(statusCommand);
    program.addCommand(pushCommand);
    program.addCommand(initCommand);
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  error: ${message}\n`);
  process.exit(1);
}

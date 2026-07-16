#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";

process.env.BIRRJS_CLI = "1";

const program = new Command().name("birrjs").description("CLI for BirrJS billing").version("0.1.2");

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
  case "add": {
    const { addCommand } = await import("./commands/add");
    program.addCommand(addCommand);
    break;
  }
  default: {
    const [{ statusCommand }, { pushCommand }, { initCommand }, { addCommand }] = await Promise.all(
      [
        import("./commands/status"),
        import("./commands/push"),
        import("./commands/init"),
        import("./commands/add"),
      ],
    );
    program.addCommand(statusCommand);
    program.addCommand(pushCommand);
    program.addCommand(initCommand);
    program.addCommand(addCommand);
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  error: ${message}\n`);
  process.exit(1);
}

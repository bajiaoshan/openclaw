import { Command, Option } from "commander";
import { afterAll, describe, expect, it } from "vitest";
import {
  itWithFish,
  itWithPowerShell,
  PowerShellCompletionRunner,
  runGeneratedBashCompletion,
  runGeneratedFishCompletion,
} from "./completion-cli.test-support.js";

const powerShellCompletion = new PowerShellCompletionRunner();

afterAll(async () => {
  await powerShellCompletion.close();
});

function createVisibilityProgram(): Command {
  const program = new Command()
    .name("openclaw")
    .option("--visible-root", "Visible root option")
    .addOption(new Option("--hidden-root").hideHelp())
    .addOption(new Option("--internal-value <value>").hideHelp());
  program.command("visible").alias("public");
  program.command("hidden", { hidden: true }).alias("private").command("child");
  const parent = program.command("parent");
  parent.option("--visible-child", "Visible child option");
  parent.addOption(new Option("--hidden-child").hideHelp());
  parent.command("visible").alias("public");
  parent.command("hidden", { hidden: true }).alias("private").option("--inside");
  return program;
}

const engines = [
  {
    name: "Bash",
    test: it.skipIf(process.platform === "win32"),
    complete: (program: Command, words: string[]) => runGeneratedBashCompletion(program, words),
  },
  {
    name: "Fish",
    test: itWithFish,
    complete: (program: Command, words: string[]) =>
      runGeneratedFishCompletion(program, words.join(" ")),
  },
  {
    name: "PowerShell",
    test: itWithPowerShell,
    complete: (program: Command, words: string[]) =>
      powerShellCompletion.complete(program, words.join(" ")),
  },
];

for (const engine of engines) {
  describe(`${engine.name} completion visibility`, () => {
    engine.test.each([
      { name: "root", prefix: ["openclaw"], visible: "--visible-root", hidden: "--hidden-root" },
      {
        name: "nested",
        prefix: ["openclaw", "parent"],
        visible: "--visible-child",
        hidden: "--hidden-child",
      },
    ])("offers only visible $name options and commands", async ({ prefix, visible, hidden }) => {
      const program = createVisibilityProgram();
      const flags = await engine.complete(program, [...prefix, "--"]);
      expect(flags).toContain(visible);
      expect(flags).toContain("--help");
      expect(flags).not.toContain(hidden);
      const commands = await engine.complete(program, [...prefix, ""]);
      expect(commands).toEqual(expect.arrayContaining(["visible", "public"]));
      expect(commands).not.toContain("hidden");
      expect(commands).not.toContain("private");
    });

    engine.test("uses each command's implicit help option", async () => {
      const program = new Command().name("openclaw");
      program.command("custom").helpOption("-H, --assist", "Show command help");
      program.command("disabled").helpOption(false);
      program.command("hidden").addHelpOption(new Option("-h, --help").hideHelp());
      program.command("shadowed").option("-h, --host <host>");

      for (const [words, expected] of [
        [["openclaw", "-h"], ["-h"]],
        [["openclaw", "custom", "--ass"], ["--assist"]],
        [["openclaw", "custom", "--he"], []],
        [["openclaw", "disabled", "--he"], []],
        [["openclaw", "hidden", "--he"], []],
        [["openclaw", "shadowed", "--he"], ["--help"]],
      ] as const) {
        expect(await engine.complete(program, [...words]), words.join(" ")).toEqual(expected);
      }
    });

    engine.test("keeps the context after a typed hidden value option", async () => {
      const completions = await engine.complete(createVisibilityProgram(), [
        "openclaw",
        "--internal-value",
        "parent",
        "parent",
        "--v",
      ]);
      expect(completions).toContain("--visible-child");
      expect(completions).not.toContain("--visible-root");
    });

    engine.test("keeps descendants after manually typed hidden command aliases", async () => {
      expect(
        await engine.complete(createVisibilityProgram(), ["openclaw", "private", "ch"]),
      ).toContain("child");
      expect(
        await engine.complete(createVisibilityProgram(), ["openclaw", "parent", "private", "--i"]),
      ).toContain("--inside");
    });
  });
}

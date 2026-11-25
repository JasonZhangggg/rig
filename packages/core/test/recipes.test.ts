// Rig's recipes: a typed step that compiles to the shorthands from Rig's own
// table, checked like the command it makes. The shared vectors hold one of each
// as the helper sees it.

import { describe, expect, it } from "vitest";
import { RECIPES, checkStep, commandHash, helperStep, recipeCommand, stepHash, stepsTitle, takesEffectWords, type Command, type RecipeStep } from "../src";
import vectors from "../src/rules/vectors.json";

const recipe = (id: string, params: Record<string, unknown>) => ({ kind: "recipe", id, params }) as RecipeStep;
const built = (c: Command | string): Command => {
  if (typeof c === "string") throw new Error(c);
  return c;
};
const valuesOf = (r: (typeof RECIPES)[number]) => Object.entries(r.params).flatMap(([name, p]) => ("values" in p ? p.values : [p.min, p.max]).map((v) => ({ [name]: v })));

describe("Rig's recipes", () => {
  it("each take one typed param, say what each value does and when it takes effect", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(Object.keys(r.params), r.id).toHaveLength(1);
      expect(["now", "sign out", "restart", "app restart"], r.id).toContain(r.takesEffect);
      expect(!!r.app, r.id).toBe(r.takesEffect === "app restart");
      for (const params of valuesOf(r)) {
        const step = recipe(r.id, params);
        const cmd = built(recipeCommand(step));
        expect(cmd.does, r.id).toMatch(/^[A-Z].{10,200}\.$/);
        expect(checkStep(step), `${r.id} ${JSON.stringify(params)}`).toMatchObject({ status: "allowed" });
      }
    }
  });

  it("are the vectors the helper's selftest parses, one for each recipe", () => {
    const ones = (vectors as { recipe?: { id: string; params: Record<string, unknown> }; step?: { cmd: Command }; expect?: { tier?: number } }[]).filter((v) => v.recipe);
    expect(ones.map((v) => v.recipe!.id).sort()).toEqual(RECIPES.map((r) => r.id).sort());
    for (const v of ones) {
      const step = recipe(v.recipe!.id, v.recipe!.params);
      expect(recipeCommand(step), v.recipe!.id).toEqual(v.step!.cmd);
      expect(checkStep(step)).toMatchObject({ status: "allowed", tier: v.expect!.tier });
    }
  });

  it("get the tier, admin rights and checks of the command they compile to, and say they're Rig's own", () => {
    const step = recipe("fastStartup", { state: "off" });
    const cmd = built(recipeCommand(step));
    expect(cmd.touches).toEqual([{ kind: "registry", key: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power", value: "HiberbootEnabled" }]);
    expect(cmd.run).toContain("-Name 'HiberbootEnabled' -Type DWord -Value 0");
    const own = checkStep({ kind: "command", cmd });
    const got = checkStep(step);
    expect(got).toMatchObject({ status: "allowed", tier: 2, admin: true, commands: own.commands });
    expect(got.status === "allowed" && got.reasons[0]).toBe("One of Rig's own recipes, not a command Claude wrote.");
    expect(helperStep(step)).toEqual({ kind: "command", cmd });
  });

  it("set every value a recipe lists, and write a number param as the type wants", () => {
    const dark = built(recipeCommand(recipe("darkMode", { state: "dark" })));
    expect(dark.touches.map((t) => t.kind === "registry" && t.value)).toEqual(["AppsUseLightTheme", "SystemUsesLightTheme"]);
    expect(dark.run.match(/New-Item/g)).toHaveLength(1);
    expect(dark.run).toContain("-Name 'AppsUseLightTheme' -Type DWord -Value 0");
    expect(dark.run).toContain("-Name 'SystemUsesLightTheme' -Type DWord -Value 0");
    expect(built(recipeCommand(recipe("menuDelay", { ms: 250 }))).run).toContain("-Name 'MenuShowDelay' -Type String -Value '250'");
    expect(built(recipeCommand(recipe("sysMain", { state: "off" }))).run).toBe("Set-Service -Name 'SysMain' -StartupType Disabled");
    const web = built(recipeCommand(recipe("startWebSearch", { state: "off" })));
    expect(web.run).toMatch(/^if \(Get-CimInstance .*PartOfDomain/);
    expect(web.touches).toEqual([{ kind: "registry", key: "HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer", value: "DisableSearchBoxSuggestions" }]);
  });

  it("refuse an unknown recipe or a value off its list in plain words, before building anything", () => {
    const words = (s: RecipeStep) => {
      const v = checkStep(s);
      return v.status === "refused" ? v.refused : `allowed: ${JSON.stringify(v)}`;
    };
    expect(words(recipe("mouseAcceleration", { state: "off" }))).toBe("This isn't one of Rig's recipes.");
    expect(words(recipe("toString", {}))).toBe("This isn't one of Rig's recipes.");
    expect(words(recipe("fileExtensions", { state: "maybe" }))).toBe("state must be show or hide.");
    expect(words(recipe("taskbarSearch", { state: 1 }))).toBe("state must be hidden, icon or box.");
    expect(words(recipe("fileExtensions", {}))).toBe("state must be show or hide.");
    expect(words(recipe("fileExtensions", { state: "show", key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" }))).toBe("fileExtensions takes only state.");
    for (const ms of [4001, -1, 1.5, "100", Number.NaN]) expect(words(recipe("menuDelay", { ms }))).toBe("ms must be a whole number from 0 to 4000.");
    expect(words({ kind: "recipe", id: "fileExtensions" } as unknown as RecipeStep)).toBe("state must be show or hide.");
    expect(helperStep(recipe("nope", {}))).toBe("This isn't one of Rig's recipes");
  });

  it("never put the model's text into a script", () => {
    expect(recipeCommand(recipe("fileExtensions", { state: "show'; Remove-Item C:\\x; '" }))).toBe("state must be show or hide");
    for (const r of RECIPES) {
      for (const params of valuesOf(r)) {
        const cmd = built(recipeCommand(recipe(r.id, params)));
        const said = Object.values(params).filter((v) => typeof v === "string");
        for (const s of said) expect(`${cmd.read}\n${cmd.run}`, r.id).not.toContain(`'${s}'`);
      }
    }
  });

  it("approve what runs: a recipe's fingerprint is its command's", async () => {
    const step = recipe("hiddenFiles", { state: "show" });
    expect(await stepHash(step)).toBe(await commandHash(built(recipeCommand(step))));
    expect(await stepHash(step)).not.toBe(await stepHash(recipe("hiddenFiles", { state: "hide" })));
  });

  it("say when they take effect, and title the changes log with Rig's sentence", () => {
    const by = (id: string) => RECIPES.find((r) => r.id === id)!;
    expect(takesEffectWords(by("storageSense"))).toBe("Takes effect now.");
    expect(takesEffectWords(by("darkMode"))).toBe("Takes effect after you sign out and back in.");
    expect(takesEffectWords(by("sysMain"))).toBe("Takes effect after you restart the PC.");
    expect(takesEffectWords(by("explorerOpensTo"))).toBe("Takes effect once you close File Explorer and open it again.");
    expect(takesEffectWords(by("fileExtensions"))).toBe("Takes effect after you sign out and back in.");
    expect(stepsTitle([recipe("fileExtensions", { state: "show" })])).toBe("Shows file extensions, like .txt, on file names in File Explorer");
  });
});

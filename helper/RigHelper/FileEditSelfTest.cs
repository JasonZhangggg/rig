// The fileEdit op's part of --selftest: real files under the person's temp
// folder, edited through the whole step path (preview, apply, undo) by the
// worker as the person, with every byte outside the edited values checked.
// Its own store, so its tier 2 changes don't count against the other checks.

using System.Text;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public static class FileEditSelfTest
{
    /// Runs each check on its own folder under the person's temp folder, named in full (Path.GetTempPath() can give a short
    /// name such as RUNNER~1, which Rig refuses), and removes them.
    public static void Run(Action<string, Func<IEnumerable<string>>> check, Commands rig)
    {
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temp", "rig-selftest-fileedit-" + CommandStore.NewId());
        string Dir(string name) => Directory.CreateDirectory(Path.Combine(root, name)).FullName;
        try
        {
            check("a file edit's fingerprint and tier", Fingerprint);
            check("a JSON file edit, applied and undone byte for byte", () => Json(rig, Dir("json")));
            check("a UTF-16 INI file edit that adds keys, applied and undone", () => Ini(rig, Dir("ini")));
            check("file edits Rig refuses", () => Refused(rig, Dir("refused")));
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { } }
    }

    static JsonNode Preview(Commands rig, JsonObject op) => rig.Handle("step.preview", new JsonObject { ["step"] = new JsonObject { ["kind"] = "native", ["op"] = op.DeepClone() } });
    static JsonNode Apply(Commands rig, JsonNode preview) => rig.Handle("step.apply", new JsonObject { ["nonce"] = preview["nonce"]?.ToString() });
    static JsonNode Undo(Commands rig, JsonNode applied, bool force = false) => rig.Handle("step.undo", new JsonObject { ["id"] = applied["undo"]?["id"]?.ToString(), ["force"] = force });
    static bool Is(JsonNode? n, string outcome) => n?["outcome"]?.ToString() == outcome;
    static string Said(JsonNode? n) => n?.ToJsonString() ?? "nothing";

    static JsonObject Op(string path, string format, params JsonObject[] edits) => new()
    {
        ["name"] = "fileEdit", ["does"] = "Rig's self-test edit.", ["path"] = path, ["format"] = format, ["edits"] = new JsonArray(edits),
    };

    static JsonObject Edit(JsonNode? value, bool add = false, params string[] at)
    {
        var e = new JsonObject { ["at"] = new JsonArray(at.Select(s => (JsonNode)s).ToArray()), ["value"] = value };
        if (add) e["add"] = true;
        return e;
    }

    /// The same op as packages/core/test/check.test.ts, with the same fingerprint and tier.
    public static IEnumerable<string> Fingerprint()
    {
        var op = Op(@"C:\Users\Sam\AppData\Roaming\Game\settings.json", "json",
            Edit(false, false, "graphics", "vsync"), Edit(new JsonObject { ["number"] = "0.85" }, false, "graphics", "scale"), Edit("Ana", true, "name"), Edit(null, false, "list", "0"), Edit(-7, false, "n"));
        op["does"] = "Turns off vertical sync.";
        op["extra"] = "dropped";
        var found = new FileEditOp().Check(op);
        string hash = new NativeOpStep("fileEdit", found.Op).Hash();
        if (hash != "397349fd42a5896a1fe1975894470362f39843f4679d48128543a6844580e466") yield return $"a file edit's is {hash}, not the app's: {found.Op.ToJsonString()}";
        if (found.Tier != 2) yield return $"a file edit that adds a key is tier {found.Tier}";
        if (new FileEditOp().Check(Op(@"C:\Users\Sam\AppData\Roaming\Game\settings.json", "json", Edit(false, false, "graphics", "vsync"))).Tier != 1) yield return "a file edit of a value in a file of your own isn't tier 1";
        if (new FileEditOp().Check(Op(@"C:\Program Files\Game\settings.json", "json", Edit(false, false, "graphics", "vsync"))).Tier != 2) yield return "a file edit of a file under Program Files isn't tier 2";
    }

    const string JsonText =
        "// Game settings\r\n{\r\n  \"graphics\": {\r\n    \"vsync\": true, /* on by default */\r\n    \"fps\": 60,\r\n    \"scale\": 1.0\r\n  },\r\n" +
        "  \"name\": \"Ana \u00d1\",\r\n  \"list\": [1, 2, 3],\r\n}\r\n";

    public static IEnumerable<string> Json(Commands rig, string dir)
    {
        string path = Path.Combine(dir, "settings.json");
        byte[] original = Encoding.UTF8.GetBytes(JsonText);
        File.WriteAllBytes(path, original);
        var op = Op(path, "json", Edit(false, false, "graphics", "vsync"), Edit(144, false, "graphics", "fps"), Edit("Bea \"B\"", false, "name"), Edit(new JsonObject { ["number"] = "2.5" }, false, "list", "1"));
        byte[] expected = Encoding.UTF8.GetBytes(JsonText.Replace("\"vsync\": true", "\"vsync\": false").Replace("\"fps\": 60", "\"fps\": 144")
            .Replace("\"Ana \u00d1\"", "\"Bea \\\"B\\\"\"").Replace("[1, 2, 3]", "[1, 2.5, 3]"));

        var p = Preview(rig, op);
        string read = p["read"]?.ToString() ?? "";
        if (!Is(p, "ready") || p["verdict"]?["tier"]?.GetValue<int>() != 1) { yield return $"the preview wasn't ready at tier 1: {Said(p)}"; yield break; }
        if (!read.StartsWith("graphics › vsync: true\ngraphics › fps: 60\nname: \"Ana \u00d1\"\nlist › 1: 2\nFile fingerprint ", StringComparison.Ordinal)) yield return $"the preview read {read}";
        if (!read.EndsWith("\n\nLine 4:\n-     \"vsync\": true, /* on by default */\n-     \"fps\": 60,\n+     \"vsync\": false, /* on by default */\n+     \"fps\": 144,\n" +
            "Line 8:\n-   \"name\": \"Ana \u00d1\",\n-   \"list\": [1, 2, 3],\n+   \"name\": \"Bea \\\"B\\\"\",\n+   \"list\": [1, 2.5, 3],", StringComparison.Ordinal)) yield return $"the preview's diff is {read}";
        if (!File.ReadAllBytes(path).SequenceEqual(original)) yield return "a preview changed the file";

        var a = Apply(rig, p);
        if (!Is(a, "applied")) { yield return $"it wasn't applied: {Said(a)}"; yield break; }
        if (!File.ReadAllBytes(path).SequenceEqual(expected)) yield return $"the file reads {File.ReadAllText(path)}, not just the four values changed";
        if (a["result"]?["after"]?.ToString().StartsWith("graphics › vsync: false\ngraphics › fps: 144\nname: \"Bea \\\"B\\\"\"\nlist › 1: 2.5\n", StringComparison.Ordinal) != true) yield return $"apply read back {a["result"]?["after"]}";
        if (Directory.GetFiles(dir).Length != 1) yield return "the edit left a file beside the one it changed";
        var u = Undo(rig, a);
        if (!Is(u, "undone") || !File.ReadAllBytes(path).SequenceEqual(original)) yield return $"undo didn't put the file back byte for byte: {Said(u)}";

        // Something else changes the file after the edit: undo stops, and puts it back only when asked anyway.
        a = Apply(rig, Preview(rig, op));
        File.AppendAllText(path, "\r\n");
        u = Undo(rig, a);
        if (!Is(u, "drifted") || !File.ReadAllBytes(path).SequenceEqual(expected.Concat(new byte[] { 13, 10 }))) yield return $"undo didn't stop at a later change: {Said(u)}";
        u = Undo(rig, a, force: true);
        if (!Is(u, "undone") || !File.ReadAllBytes(path).SequenceEqual(original)) yield return $"undo with force didn't put the file back: {Said(u)}";

        // The file changes between the preview the person saw and the apply: nothing runs.
        p = Preview(rig, op);
        byte[] other = Encoding.UTF8.GetBytes(JsonText.Replace("\"fps\": 60", "\"fps\": 61"));
        File.WriteAllBytes(path, other);
        a = Apply(rig, p);
        if (!Is(a, "refused") || !File.ReadAllBytes(path).SequenceEqual(other)) yield return $"an apply after the file changed since its preview wasn't refused: {Said(a)}";

        // A key added at the end of an object, the way the one before it is written.
        File.WriteAllBytes(path, original);
        a = Apply(rig, Preview(rig, Op(path, "json", Edit(true, true, "graphics", "hdr"))));
        string added = JsonText.Replace("\"scale\": 1.0\r\n", "\"scale\": 1.0,\r\n    \"hdr\": true\r\n");
        if (!Is(a, "applied") || File.ReadAllText(path) != added) yield return $"adding a key gave {File.ReadAllText(path)}: {Said(a)}";
        else if (!Is(Undo(rig, a), "undone") || !File.ReadAllBytes(path).SequenceEqual(original)) yield return "undo didn't take out the key it added";
    }

    const string IniText = "; Game config\r\n[Graphics]\r\nVSync=1\r\nQuality = \"High\"\r\n# comment\r\n[Audio]\r\nVolume=80\r\n";

    public static IEnumerable<string> Ini(Commands rig, string dir)
    {
        string path = Path.Combine(dir, "Game.cfg");
        byte[] original = [.. Encoding.Unicode.GetPreamble(), .. Encoding.Unicode.GetBytes(IniText)];
        File.WriteAllBytes(path, original);
        var op = Op(path, "ini", Edit("0", false, "graphics", "vsync"), Edit("Low", false, "Graphics", "Quality"), Edit(5, true, "Graphics", "NewKey"), Edit(7777, true, "Network", "Port"));
        string text = IniText.Replace("VSync=1", "VSync=0").Replace("\"High\"\r\n", "\"Low\"\r\nNewKey=5\r\n") + "[Network]\r\nPort=7777\r\n";
        byte[] expected = [.. Encoding.Unicode.GetPreamble(), .. Encoding.Unicode.GetBytes(text)];

        var p = Preview(rig, op);
        if (!Is(p, "ready") || p["verdict"]?["tier"]?.GetValue<int>() != 2) { yield return $"the preview wasn't ready at tier 2: {Said(p)}"; yield break; }
        if (p["read"]?.ToString().StartsWith("graphics › vsync: 1\nGraphics › Quality: \"High\"\nGraphics › NewKey: Not there\nNetwork › Port: Not there\n", StringComparison.Ordinal) != true) yield return $"the preview read {p["read"]}";
        var a = Apply(rig, p);
        if (!Is(a, "applied")) { yield return $"it wasn't applied: {Said(a)}"; yield break; }
        if (!File.ReadAllBytes(path).SequenceEqual(expected)) yield return $"the file reads {Encoding.Unicode.GetString(File.ReadAllBytes(path))}";
        var u = Undo(rig, a);
        if (!Is(u, "undone") || !File.ReadAllBytes(path).SequenceEqual(original)) yield return $"undo didn't put the file back byte for byte: {Said(u)}";
    }

    public static IEnumerable<string> Refused(Commands rig, string dir)
    {
        string Write(string name, byte[] bytes) { string f = Path.Combine(dir, name); File.WriteAllBytes(f, bytes); return f; }
        var vsync = Edit(false, false, "graphics", "vsync");
        var cases = new (string What, JsonObject Op, string Says, string? Why)[]
        {
            ("a file on the never list", Op(Write("logins.json", Encoding.UTF8.GetBytes("{\"graphics\": {\"vsync\": true}}")), "json", vsync), "Rig never", "never"),
            ("a script", Op(Write("start.ps1", Encoding.UTF8.GetBytes("{}")), "json", vsync), "doesn't edit programs", null),
            ("a key that is there twice", Op(Write("twice.json", Encoding.UTF8.GetBytes("{\"graphics\": {\"vsync\": true, \"vsync\": false}}")), "json", vsync), "twice", null),
            ("an INI key that is there twice", Op(Write("twice.ini", Encoding.UTF8.GetBytes("[Graphics]\nVSync=1\nvsync=0\n")), "ini", Edit("0", false, "Graphics", "VSync")), "more than once", null),
            ("a file over 1 MB", Op(Write("big.json", Encoding.UTF8.GetBytes("{\"graphics\": {\"vsync\": true}, \"pad\": \"" + new string('x', FileEditOp.MaxBytes) + "\"}")), "json", vsync), "over 1 MB", null),
            ("a file that isn't UTF-8", Op(Write("latin.ini", [.. Encoding.ASCII.GetBytes("[Graphics]\nName=Jos"), 0xE9, 10]), "ini", Edit("x", false, "Graphics", "Name")), "UTF-8", null),
            ("a value that isn't there", Op(Write("missing.json", Encoding.UTF8.GetBytes("{\"graphics\": {}}")), "json", vsync), "didn't find", null),
            ("a group of values", Op(Write("group.json", Encoding.UTF8.GetBytes("{\"graphics\": {\"vsync\": [1]}}")), "json", vsync), "single values", null),
        };
        foreach (var (what, op, says, why) in cases)
        {
            string path = op["path"]!.ToString();
            byte[] was = File.ReadAllBytes(path);
            var p = Preview(rig, op);
            string refused = p["verdict"]?["refused"]?.ToString() ?? "";
            if (!Is(p, "refused") || !refused.Contains(says, StringComparison.Ordinal) || (why != null && p["verdict"]?["why"]?.ToString() != why)) yield return $"{what} wasn't refused saying \"{says}\": {Said(p)}";
            if (!File.ReadAllBytes(path).SequenceEqual(was)) yield return $"{what} was changed";
        }
    }
}

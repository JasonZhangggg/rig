// The screen step: setting one control in an app's window, for a setting
// that only exists behind the app's buttons.
//
// The model sends only { lookId, to, does }. Everything else is the look:
//
//   look   "screen.look" { app, goal }. The helper works out which program
//          `app` means from Rig's own rules and refuses the ones Rig never
//          drives. The worker walks to the control named last in `goal`,
//          selecting tabs and list items and opening sections but pressing
//          nothing, and reads it. The helper keeps what the worker found
//          (the program, its signer, each hop, the value, what the control
//          offers) under a new lookId, in its own store.
//   check  A step is refused unless its look is in the store and offers
//          `to`. The step Rig keeps and fingerprints carries the whole look,
//          so an approval is of that exact walk, and the worker never has to
//          be told anything by the far side of the pipe.
//   apply  The worker walks the kept hops again, each of which must still be
//          the same single control, stops if the value isn't what the look
//          read, sets it, presses the app's Apply and reads it back.
//   undo   The same walk with the old value, read back.
//
// Screen steps are always tier 3: Rig can't know what the app writes, and
// undo by repeating the walk can miss if the app has changed.

using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

/// The `screen` rules in commands.json: which programs Rig may drive, and what it may read and press in them.
static class ScreenRules
{
    sealed class App { public string Name { get; set; } = ""; public string? Aumid { get; set; } public string? Exe { get; set; } public string Image { get; set; } = ""; }
    sealed class RefusedList { public string Says { get; set; } = ""; public string[] Images { get; set; } = []; }
    sealed class Rules
    {
        public int MaxText { get; set; }
        public int MaxGoal { get; set; }
        public int LookMinutes { get; set; }
        public string[] Roots { get; set; } = [];
        public string[] RootsExcept { get; set; } = [];
        public App[] Apps { get; set; } = [];
        public string SettingsImage { get; set; } = "";
        public string[] SettingsPages { get; set; } = [];
        public RefusedList[] Refused { get; set; } = [];
        public string SettingsRefused { get; set; } = "";
        public string[] ContentHosts { get; set; } = [];
        public string[] NeverNames { get; set; } = [];
        public string[] ApplyButtons { get; set; } = [];
    }

    static readonly Rules R = JsonNode.Parse(CommandCheck.Resource("Rig.Rules.commands.json"))!["screen"].Deserialize<Rules>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

    public const string NotInstalled = "Rig only works the buttons of programs installed for the whole PC, under Program Files or Windows.";
    public static int MaxText => R.MaxText;
    public static int MaxGoal => R.MaxGoal;
    public static int LookMinutes => R.LookMinutes;
    public static IReadOnlyList<string> ApplyButtons => R.ApplyButtons;

    /// Text an app wrote, made safe to show and to hand to the model: one line, plain ASCII, at most `maxText` characters.
    public static string Clean(string? raw)
    {
        string line = Regex.Replace(Regex.Replace(raw ?? "", @"[^\x20-\x7e]", m => char.IsWhiteSpace(m.Value[0]) ? " " : "?"), " {2,}", " ").Trim();
        return line.Length <= R.MaxText ? line : line[..R.MaxText].TrimEnd();
    }

    /// Whether this is text Rig would send or take as it stands.
    public static bool Plain(string? text) => !string.IsNullOrEmpty(text) && text == Clean(text);

    public static bool NeverName(string name) => R.NeverNames.Any(n => name.Contains(n, StringComparison.OrdinalIgnoreCase));

    public static bool ContentHost(string image) => R.ContentHosts.Contains(Path.GetFileName(image).ToLowerInvariant());

    static string? RefusedName(string file, string? page)
    {
        string name = file.ToLowerInvariant();
        if (R.Refused.FirstOrDefault(r => r.Images.Contains(name)) is RefusedList list) return $"{list.Says}.";
        return name == R.SettingsImage && (page == null || !R.SettingsPages.Contains(page)) ? $"{R.SettingsRefused}." : null;
    }

    /// Why Rig won't drive the program at this path, in plain words, or null. `page` is the Settings page it was opened on.
    public static string? Refusal(string image, string? page)
    {
        string path = image.ToLowerInvariant().Replace('/', '\\');
        if (!Regex.IsMatch(path, @"^[a-z]:\\[^:]*\z") || path.Contains(@"\..\") || path.Contains(@"\\") || Regex.IsMatch(path, @"~\d")) return NotInstalled;
        if (!R.Roots.Any(r => path.StartsWith(r, StringComparison.Ordinal)) || R.RootsExcept.Any(r => path.StartsWith(r, StringComparison.Ordinal))) return NotInstalled;
        if (Environment.ProcessPath is string me && Path.GetDirectoryName(path) == Path.GetDirectoryName(me)!.ToLowerInvariant()) return "Rig doesn't drive its own windows.";
        return RefusedName(Path.GetFileName(path), page);
    }

    /// Which program an `app` in a look request means. Throws in plain words for one Rig doesn't know or never drives.
    public static ScreenApp Resolve(string ask)
    {
        string name = ask.Trim();
        if (R.Apps.FirstOrDefault(a => a.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) is App known)
            return known.Aumid != null ? new ScreenApp("aumid", known.Aumid, known.Image, null) : new ScreenApp("exe", known.Exe!, known.Exe!, null);
        if (name.StartsWith("ms-settings:", StringComparison.OrdinalIgnoreCase))
        {
            string page = name["ms-settings:".Length..].ToLowerInvariant();
            return R.SettingsPages.Contains(page) ? new ScreenApp("settings", "", R.SettingsImage, page) : throw new RigException($"{R.SettingsRefused}.");
        }
        if (!name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new RigException($"Rig doesn't know an app by that name. Name one of its own ({string.Join(", ", R.Apps.Select(a => a.Name))}), a Settings page such as ms-settings:display, or a program's .exe.");
        // A program named by its .exe is only ever found open, never started: a look is a read, and starting a program
        // can be a change in itself. Rig starts only the apps and Settings pages its own rules list.
        if (name.Contains('\\') || name.Contains('/'))
            return Refusal(name, null) is string refused ? throw new RigException(refused) : new ScreenApp("open", "", name, null);
        return RefusedName(name, null) is string no ? throw new RigException(no) : new ScreenApp("open", "", name, null);
    }
}

/// Who signed a program, as Windows itself judges it.
static class Signing
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WINTRUST_FILE_INFO { public int Size; public string Path; public IntPtr File, KnownSubject; }
    [StructLayout(LayoutKind.Sequential)]
    struct WINTRUST_DATA
    {
        public int Size; public IntPtr PolicyData, SipData; public uint UiChoice, Revocation, UnionChoice; public IntPtr Info;
        public uint StateAction; public IntPtr State, Url; public uint ProvFlags, UiContext; public IntPtr SignatureSettings;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CATALOG_INFO { public int Size; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string File; }

    [DllImport("wintrust.dll")] static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WINTRUST_DATA data);
    [DllImport("wintrust.dll", CharSet = CharSet.Unicode)] static extern bool CryptCATAdminAcquireContext2(out IntPtr admin, IntPtr subsystem, string algorithm, IntPtr policy, uint flags);
    [DllImport("wintrust.dll")] static extern bool CryptCATAdminCalcHashFromFileHandle2(IntPtr admin, SafeFileHandle file, ref int size, byte[] hash, uint flags);
    [DllImport("wintrust.dll")] static extern IntPtr CryptCATAdminEnumCatalogFromHash(IntPtr admin, byte[] hash, int size, uint flags, IntPtr previous);
    [DllImport("wintrust.dll")] static extern bool CryptCATCatalogInfoFromContext(IntPtr catalog, ref CATALOG_INFO info, uint flags);
    [DllImport("wintrust.dll")] static extern bool CryptCATAdminReleaseCatalogContext(IntPtr admin, IntPtr catalog, uint flags);
    [DllImport("wintrust.dll")] static extern bool CryptCATAdminReleaseContext(IntPtr admin, uint flags);

    /// Whether Windows trusts the signature inside this file. No window is shown and nothing is fetched from the internet.
    static bool Trusted(string path)
    {
        var file = new WINTRUST_FILE_INFO { Size = Marshal.SizeOf<WINTRUST_FILE_INFO>(), Path = path };
        IntPtr info = Marshal.AllocHGlobal(file.Size);
        try
        {
            Marshal.StructureToPtr(file, info, false);
            var data = new WINTRUST_DATA { Size = Marshal.SizeOf<WINTRUST_DATA>(), UiChoice = 2, UnionChoice = 1, Info = info, ProvFlags = 0x1000 };
            var verify = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            return WinVerifyTrust(new IntPtr(-1), ref verify, ref data) == 0;
        }
        finally
        {
            Marshal.DestroyStructure<WINTRUST_FILE_INFO>(info);
            Marshal.FreeHGlobal(info);
        }
    }

    /// The Windows catalog that lists this file, which is how Windows' own programs are signed, or null.
    static string? Catalog(string path)
    {
        if (!CryptCATAdminAcquireContext2(out IntPtr admin, IntPtr.Zero, "SHA256", IntPtr.Zero, 0)) return null;
        try
        {
            using var file = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
            var hash = new byte[64];
            int size = hash.Length;
            if (!CryptCATAdminCalcHashFromFileHandle2(admin, file, ref size, hash, 0)) return null;
            IntPtr catalog = CryptCATAdminEnumCatalogFromHash(admin, hash, size, 0, IntPtr.Zero);
            if (catalog == IntPtr.Zero) return null;
            try
            {
                var info = new CATALOG_INFO { Size = Marshal.SizeOf<CATALOG_INFO>() };
                return CryptCATCatalogInfoFromContext(catalog, ref info, 0) ? info.File : null;
            }
            finally { CryptCATAdminReleaseCatalogContext(admin, catalog, 0); }
        }
        finally { CryptCATAdminReleaseContext(admin, 0); }
    }

    static string Subject(string signed, string fallback)
    {
#pragma warning disable SYSLIB0057
        try { using var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(signed)); return cert.GetNameInfo(X509NameType.SimpleName, false) is { Length: > 0 } name ? name : fallback; }
#pragma warning restore SYSLIB0057
        catch (Exception) { return fallback; }
    }

    /// The name on the certificate that validly signs this program, or null when Windows doesn't trust its signature or it has none.
    public static string? Signer(string path)
    {
        try
        {
            if (Trusted(path)) return Subject(path, "A signer Windows trusts");
            return Catalog(path) is string catalog && Trusted(catalog) ? Subject(catalog, "A Windows catalog") : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or DllNotFoundException or EntryPointNotFoundException) { return null; }
    }
}

/// The looks the helper keeps, by id, in its own store. Only the helper reads them, when it checks a step.
static class ScreenLooks
{
    const int Keep = 200;
    static readonly Lazy<string> Dir = new(() => Directory.CreateDirectory(Path.Combine(CommandStore.Open().Root, "looks")).FullName);

    public static void Save(JsonObject look)
    {
        var old = new DirectoryInfo(Dir.Value).GetFiles().OrderByDescending(f => f.LastWriteTimeUtc).ToList();
        foreach (var f in old.Where((f, i) => i >= Keep - 1 || f.LastWriteTimeUtc < DateTime.UtcNow.AddDays(-CommandStore.KeepRecordDays)))
            try { f.Delete(); } catch (IOException) { }
        File.WriteAllText(Path.Combine(Dir.Value, look["lookId"] + ".json"), look.ToJsonString());
    }

    public static JsonObject? Find(string id)
    {
        if (!CommandStore.Id.IsMatch(id)) return null;
        string file = Path.Combine(Dir.Value, id + ".json");
        if (Native.IsAdmin() && !AdminFile.Trusted(file)) return null;
        try { return JsonNode.Parse(File.ReadAllText(file)) is JsonObject look && look["lookId"]?.ToString() == id ? look : null; }
        catch (Exception e) when (e is IOException or JsonException) { return null; }
    }
}

/// `test`: the self-test's own instance, which alone may look at the self-test's window.
sealed class ScreenStep(bool test) : INativeStep
{
    public const string TestApp = "rig-selftest";
    const string Changed = "The app isn't as it was when Rig looked, so Rig stopped. Look again.";
    static readonly Regex NumberText = new(@"^-?[0-9]{1,9}(\.[0-9]{1,6})?\z");

    public string Name => "screen";

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static double Num(string text) => double.Parse(text, CultureInfo.InvariantCulture);

    static bool Offers(JsonObject look, string to) => Str(look["kind"]) == "range"
        ? NumberText.IsMatch(to) && Num(to) >= Num(Str(look["min"])!) && Num(to) <= Num(Str(look["max"])!)
        : look["options"]!.AsArray().Any(o => Str(o) == to);

    // ----- In the helper -----

    public NativeCheck Check(JsonObject op)
    {
        if (Str(op["lookId"]) is not string id || !CommandStore.Id.IsMatch(id) || Str(op["to"]) is not string to || !ScreenRules.Plain(to) || Str(op["does"]) is not string does || does.Trim().Length == 0 || does.Length > 300)
            throw new RigException("A change in an app's window needs the look it came from, the new value and one sentence.");
        if (ScreenLooks.Find(id) is not JsonObject look || (AppOf(look["app"]).Kind == "test") != test) throw new RigException($"{CommandCheck.Words("screen-look")}.");
        if (!Offers(look, to) || ScreenRules.NeverName(to)) throw new RigException($"{CommandCheck.Words("screen-option")}.");
        if (Str(look["value"]) == to) throw new RigException($"{CommandCheck.Words("screen-same")}.");
        // The rules may have changed since the look.
        if (!test && ScreenRules.Refusal(Str(look["image"])!, AppOf(look["app"]).Page) is string refused) throw new RigException(refused);
        // Whatever came in as `look` is dropped: the walk is only ever the one the helper kept.
        var kept = new JsonObject { ["name"] = Name, ["lookId"] = id, ["to"] = to, ["does"] = does, ["look"] = look.DeepClone() };
        return new NativeCheck(kept, 3, [$"{CommandCheck.Words("screen-tier")}."], []);
    }

    static JsonObject Refused(string why) => new() { ["refused"] = why };

    /// screen.look: has the worker walk to a control and read it, and keeps what it found. Changes nothing.
    public static JsonNode LookFor(Person person, CommandStore store, JsonNode? p, bool test)
    {
        if (Str(p?["app"]) is not string ask || !ScreenRules.Plain(ask) || p!["goal"] is not JsonArray names || names.Count < 1 || names.Count > ScreenRules.MaxGoal || names.Any(n => !ScreenRules.Plain(Str(n))))
            return Refused($"A look needs the app and the names of up to {ScreenRules.MaxGoal} controls to walk through, each one short line of plain text.");
        if (names.Select(n => Str(n)!).FirstOrDefault(ScreenRules.NeverName) is string never) return Refused($"Rig doesn't open or change anything named like that in an app (\"{never}\").");
        ScreenApp app;
        try { app = test && ask == TestApp ? new ScreenApp("test", ScreenTestWindow.Class, "", null) : ScreenRules.Resolve(ask); }
        catch (RigException e) { return Refused(e.Message); }
        var request = new JsonObject { ["name"] = "screen", ["app"] = JsonSerializer.SerializeToNode(app), ["ask"] = ask, ["goal"] = names.DeepClone() };
        var said = NativeWorker.Ask(person, store, "look", new NativeOpStep("screen", request), null, test);
        if (!said.Ok) return Refused(said.Error);

        // What the worker answers is read like anything from outside: the program is held to the rules again here, and
        // every name and value is cut to what Rig shows.
        var seen = said.Result;
        if (Str(seen["image"]) is not string image || (app.Kind != "test" && ScreenRules.Refusal(image, app.Page) is not null)) return Refused(ScreenRules.NotInstalled);
        static JsonObject? HopOf(JsonNode? n) => Str(n?["name"]) is { Length: <= 512 } name && Str(n!["id"]) is { Length: <= 512 } hopId && n["type"]?.GetValueKind() == JsonValueKind.Number
            ? new JsonObject { ["name"] = name, ["type"] = (int)Json.Num(n["type"], 0), ["id"] = hopId } : null;
        var hops = (seen["hops"] as JsonArray ?? []).Select(HopOf).ToList();
        string kind = Str(seen["kind"]) ?? "";
        var options = (seen["options"] as JsonArray ?? []).Select(Str).ToList();
        if (hops.Count != names.Count || hops.Contains(null) || kind is not ("toggle" or "choice" or "range") || options.Count > 200 || options.Any(o => !ScreenRules.Plain(o))
            || (kind == "range" && (Str(seen["min"]) is not string lo || Str(seen["max"]) is not string hi || !NumberText.IsMatch(lo) || !NumberText.IsMatch(hi))))
            return Refused("Rig's worker read the app's window in a way Rig can't use.");
        string signer = app.Kind == "test" ? "" : Signing.Signer(image) ?? "";
        var look = new JsonObject
        {
            ["lookId"] = CommandStore.NewId(), ["person"] = person.Sid, ["expiresAt"] = Now + ScreenRules.LookMinutes * 60_000L,
            ["ask"] = ask, ["app"] = JsonSerializer.SerializeToNode(app), ["image"] = image, ["signer"] = signer,
            ["hops"] = new JsonArray(hops.ToArray()), ["kind"] = kind, ["value"] = ScreenRules.Clean(Str(seen["value"])),
            ["options"] = new JsonArray(options.Select(o => (JsonNode)o!).ToArray()),
        };
        if (kind == "range") { look["min"] = Str(seen["min"]); look["max"] = Str(seen["max"]); }
        ScreenLooks.Save(look);

        var reply = new JsonObject
        {
            ["lookId"] = look["lookId"]!.DeepClone(), ["path"] = new JsonArray(names.Select(n => n!.DeepClone()).ToArray()), ["value"] = look["value"]!.DeepClone(),
            // Clean: Rig read only the names and values of the app's own controls, in a signed program that isn't a host for web content.
            ["clean"] = signer.Length > 0 && !ScreenRules.ContentHost(image) && seen["document"]?.GetValueKind() == JsonValueKind.False,
        };
        if (kind == "range") reply["range"] = new JsonObject { ["min"] = Num(Str(seen["min"])!), ["max"] = Num(Str(seen["max"])!) };
        else reply["options"] = look["options"]!.DeepClone();
        return reply;
    }

    // ----- In the worker -----

    static ScreenApp AppOf(JsonNode? n) => n.Deserialize<ScreenApp>() ?? throw new RigException(Changed);
    static string Title(JsonObject look) => ScreenRules.Clean(Str(look["ask"]));

    /// The worker's part of a look: walks the goal's names and reads the control at the end.
    public JsonObject Look(JsonObject ask)
    {
        var app = AppOf(ask["app"]);
        if ((app.Kind == "test") != test) throw new RigException(Commands.UnknownOp);
        using var walk = ScreenWalk.Open(app, $"Rig is looking at a setting in {ScreenRules.Clean(Str(ask["ask"]))}.");
        var (hops, target) = walk.Walk(ask["goal"]!.AsArray().Select(n => Str(n)!).ToList());
        var now = walk.Read();
        static JsonNode Kept(Hop h) => new JsonObject { ["name"] = h.Name, ["type"] = h.Type, ["id"] = h.Id };
        return new JsonObject
        {
            ["image"] = walk.Image, ["hops"] = new JsonArray([.. hops.Select(Kept), Kept(target)]), ["kind"] = now.Kind, ["value"] = now.Value,
            ["options"] = new JsonArray(now.Options.Select(o => (JsonNode)o).ToArray()), ["min"] = now.Min, ["max"] = now.Max, ["document"] = walk.ReadDocument,
        };
    }

    /// Walks the hops the look kept, in the program the look was of, and hands over the control's reading.
    T At<T>(JsonObject op, string doing, Func<ScreenWalk, ScreenReading, JsonObject, T> then)
    {
        var look = op["look"]!.AsObject();
        var app = AppOf(look["app"]);
        using var me = WindowsIdentity.GetCurrent();
        if ((app.Kind == "test") != test || Str(look["person"]) != me.User?.Value) throw new RigException(Commands.UnknownOp);
        var hops = look["hops"]!.AsArray().Select(h => new Hop(Str(h!["name"])!, (int)Json.Num(h["type"], 0), Str(h["id"])!)).ToList();
        using var walk = ScreenWalk.Open(app, $"Rig is {doing} {ScreenRules.Clean(hops[^1].Name)} in {Title(look)}.");
        // The same program by name and signer, wherever an update has moved it.
        if (!test && (!Path.GetFileName(walk.Image).Equals(Path.GetFileName(Str(look["image"])), StringComparison.OrdinalIgnoreCase) || (Signing.Signer(walk.Image) ?? "") != Str(look["signer"])))
            throw new RigException(Changed);
        walk.Walk(hops.Select(h => ScreenRules.Clean(h.Name)).ToList(), hops);
        var now = walk.Read();
        if (now.Kind != Str(look["kind"])) throw new RigException(Changed);
        return then(walk, now, look);
    }

    public string Preview(JsonObject op) => At(op, "reading", (_, now, _) => now.Value);

    public string? Verify(JsonObject op) => At(op, "reading", (_, now, _) => now.Value == Str(op["to"]) ? null : $"The setting reads {now.Value}.");

    /// Sets the control, presses the app's Apply and reads the value back; throws when it isn't `to` afterwards.
    static void Change(ScreenWalk walk, ScreenReading now, string to)
    {
        walk.Set(now, to);
        walk.PressApply();
        if (walk.Settled(to) is string got && got != to) throw new RigException($"The setting reads {got} after the change.");
    }

    public JsonObject Apply(JsonObject op) => At(op, "changing", (walk, now, look) =>
    {
        string was = Str(look["value"])!, to = Str(op["to"])!;
        if (Now > (long)Json.Num(look["expiresAt"], 0)) throw new RigException($"{CommandCheck.Words("screen-look")}.");
        if (now.Value != was) throw new RigException($"The setting reads {now.Value} now, not {was} as it did when Rig looked, so Rig changed nothing. Look again.");
        if (now.Kind != "range" && !now.Options.Contains(to)) throw new RigException($"{CommandCheck.Words("screen-option")} any more. Look again.");
        try { Change(walk, now, to); }
        // Stop means stop: nothing more is pressed, not even to put it back.
        catch (RigException e) when (e.Message == StopBar.Pressed) { throw new RigException($"{StopBar.Pressed} It had started on the change, so check the setting in the app."); }
        catch (RigException e)
        {
            string back;
            try { Change(walk, walk.Read(), was); back = "Rig set it back."; }
            catch (RigException) { back = "Rig couldn't set it back either, so check the setting in the app."; }
            throw new RigException($"{e.Message} {back}");
        }
        return new JsonObject { ["was"] = was };
    });

    public void Undo(JsonObject op, JsonObject back) => At(op, "changing", (walk, now, _) =>
    {
        string was = Str(back["was"]) ?? throw new RigException("Rig has no note of what the setting was.");
        if (now.Value != was) Change(walk, now, was);
        return true;
    });
}

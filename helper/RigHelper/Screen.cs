// Screen steps: setting one control in an app's window (ScreenOp in
// packages/core/src/change.ts).
//
//   look     screen.look names an app and the controls to walk to. The worker
//            opens the app as the person (starting only an app from Rig's
//            list or a Settings page), walks there, reads the control and
//            selects nothing but tabs and tree rows, never in web content. The
//            helper reads the window's program and package from its process,
//            holds them to the rules again, finds its signer itself, keeps
//            what was found (the program and signer, each hop, the value, the
//            choices) in memory under an id that runs out, and answers with
//            the id and plain words.
//   step     { lookId, to, does }: the step names the look and the new value,
//            never where to press. It goes through the one approval path in
//            Commands.cs like every native op; this file is its INativeStep.
//   replay   preview, apply, read-back and undo each walk the kept hops again
//            in a fresh worker (ScreenWalk.cs). A hop must match exactly one
//            control of the looked-at program, or the walk stops.
//
// Which apps may be driven, and when a look's text counts as Rig's own, is in
// rules/commands.json under `screen`.

using System.Collections.Concurrent;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

/// The app a look names, as Rig starts and recognises it. `Start` is what Windows' shell is asked to open: an app from
/// Rig's list or a Settings page, else empty and the app is only used when already open. `Image` is the full path of its
/// program when the look gave one, else the program's file name; both folded. A listed app also has the folders its
/// program may run from, its packages and its makers' signers (rules/commands.json `screen.apps`).
public sealed record ScreenApp(string Name, string Start, string Image, bool Settings = false, bool SelfTest = false)
{
    public string[] Folders { get; init; } = [];
    public string[] Families { get; init; } = [];
    public string[] Signers { get; init; } = [];
    public bool AppliesOnChange { get; init; }
    public bool Listed => Folders.Length > 0;
}

/// rules/commands.json `screen`, and what it says of an app's name and of a window's program.
public static class ScreenRules
{
    class Known
    {
        public string Name { get; set; } = ""; public string Image { get; set; } = "";
        public string[] Folders { get; set; } = []; public string[] Families { get; set; } = []; public string[] Signers { get; set; } = [];
    }
    sealed class App : Known { public string Aumid { get; set; } = ""; }
    sealed class SettingsApp : Known { public string[] Pages { get; set; } = []; public bool AppliesOnChange { get; set; } }
    sealed class Refuse { public string Says { get; set; } = ""; public string[] Images { get; set; } = []; }
    sealed class StartRule { public string Says { get; set; } = ""; public string[] Starts { get; set; } = []; }
    public sealed class CommitNames { public string[] Apply { get; set; } = []; public string[] Ok { get; set; } = []; public string[] Cancel { get; set; } = []; }
    public sealed class Example { public string App { get; set; } = ""; public bool Refused { get; set; } }
    public sealed class ImageExample
    {
        public string App { get; set; } = ""; public string Image { get; set; } = ""; public string Family { get; set; } = ""; public string? Signer { get; set; }
        public bool Is { get; set; } public bool Trusted { get; set; }
    }
    sealed class Set
    {
        public int LookMinutes { get; set; }
        public string[] Roots { get; set; } = [];
        public string[] NotRoots { get; set; } = [];
        public string[] WindowsSigners { get; set; } = [];
        public App[] Apps { get; set; } = [];
        public SettingsApp Settings { get; set; } = new();
        public Refuse[] Refuse { get; set; } = [];
        public StartRule RefuseStarts { get; set; } = new();
        public string[] ContentHosts { get; set; } = [];
        public CommitNames Commit { get; set; } = new();
        public string[] NeverNames { get; set; } = [];
        public Dictionary<string, string> Words { get; set; } = [];
        public Example[] Examples { get; set; } = [];
        public ImageExample[] ImageExamples { get; set; } = [];
    }

    static readonly Set S = JsonNode.Parse(CommandCheck.Resource("Rig.Rules.commands.json"))!["screen"].Deserialize<Set>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

    public const string SelfTestApp = "rig-selftest";
    public static int LookMinutes => S.LookMinutes;
    public static CommitNames Commit => S.Commit;
    public static IReadOnlyList<Example> Examples => S.Examples;
    public static IReadOnlyList<ImageExample> ImageExamples => S.ImageExamples;
    public static string Words(string which) => S.Words[which] + ".";

    /// Whether a control's name or a value is one Rig never walks through, sets or presses: a name in the list that starts
    /// a word, so "Reset" counts and "Preset" doesn't.
    public static bool NeverName(string text) => Never.IsMatch(text);
    static readonly Regex Never = new($"(?<![a-z0-9])({string.Join("|", S.NeverNames.Select(Regex.Escape))})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    static readonly Regex Line = new(@"^[\x20-\x7e]{1,260}\z"), Dots = new(@"(^|\\)\.\.(\\|$)"), ShortName = new(@"[a-z0-9]~\d"), Odd = new("[/*?\"<>|]");

    const string Packaged = @"c:\program files\windowsapps\", Windows = @"c:\windows\";

    /// Under Program Files or Windows, and not in a folder there that any user can write to and run from.
    static bool UnderRoots(string folded) => S.Roots.Any(r => folded.StartsWith(r, StringComparison.Ordinal)) && !S.NotRoots.Any(r => folded.StartsWith(r, StringComparison.Ordinal));

    /// Why Rig won't drive a program with this file name, or null.
    static string? RefusedImage(string file) =>
        S.Refuse.FirstOrDefault(r => r.Images.Contains(file))?.Says is string says ? says + "."
        : S.RefuseStarts.Starts.Any(s => file.StartsWith(s, StringComparison.Ordinal)) ? S.RefuseStarts.Says + "."
        : null;

    /// The app a look names, or a RigException that says why Rig won't look at it. screenAppRefusal in screen.ts agrees.
    public static ScreenApp Resolve(string? app, bool selfTest)
    {
        if (app == null || !Line.IsMatch(app)) throw new RigException(Words("app"));
        if (selfTest && app == SelfTestApp) return new ScreenApp("Rig's self-test window", "", Environment.ProcessPath!.ToLowerInvariant(), SelfTest: true);
        string name = app.ToLowerInvariant();
        if (S.Apps.FirstOrDefault(a => a.Name.ToLowerInvariant() == name) is App known) return Of(known, new ScreenApp(known.Name, @"shell:AppsFolder\" + known.Aumid, known.Image));
        if (name.StartsWith("ms-settings:", StringComparison.Ordinal))
        {
            if (!S.Settings.Pages.Contains(name["ms-settings:".Length..])) throw new RigException(RefusedImage(S.Settings.Image)!);
            return Of(S.Settings, new ScreenApp(S.Settings.Name, name, S.Settings.Image, Settings: true) { AppliesOnChange = S.Settings.AppliesOnChange });
        }
        if (!UnderRoots(name) || !name.EndsWith(".exe", StringComparison.Ordinal) || Dots.IsMatch(name) || ShortName.IsMatch(name) || Odd.IsMatch(name) || name.Contains(@"\\")) throw new RigException(Words("app"));
        if (RefusedImage(Path.GetFileName(name)) is string refused) throw new RigException(refused);
        return new ScreenApp(Path.GetFileNameWithoutExtension(app), "", name);
    }

    static ScreenApp Of(Known known, ScreenApp app) => app with
    {
        Folders = known.Folders, Families = known.Families.Select(f => f.ToLowerInvariant()).ToArray(), Signers = known.Signers,
    };

    /// Whether a window's own program is the app Rig was asked for, by its full path and, for a listed app, the package it
    /// runs as (`family`, empty when it runs as none). A program on the refused list never is.
    public static bool Is(ScreenApp app, string image, string? family)
    {
        string path = image.ToLowerInvariant(), file = Path.GetFileName(path);
        if (app.SelfTest) return path == app.Image;
        if (!app.Listed) return RefusedImage(file) == null && path == app.Image && UnderRoots(path);
        if (file != app.Image || Dots.IsMatch(path) || !app.Folders.Any(f => path.StartsWith(f, StringComparison.Ordinal))) return false;
        return string.IsNullOrEmpty(family) ? !path.StartsWith(Packaged, StringComparison.Ordinal) : app.Families.Contains(family.ToLowerInvariant());
    }

    /// Whether what this program's window says counts as Rig's own text: it is the app, installed where only admins can
    /// write, signed by its maker (a listed app's package or signers, Microsoft under Windows, any valid signer under Program
    /// Files), and not a program that shows documents. The self-test's window stands in for one.
    public static bool Trusted(ScreenApp app, string image, string? signer, string? family)
    {
        if (app.SelfTest) return true;
        string path = image.ToLowerInvariant();
        if (!Is(app, image, family) || S.ContentHosts.Contains(Path.GetFileName(path))) return false;
        if (app.Listed) return !string.IsNullOrEmpty(family) || (signer != null && app.Signers.Contains(signer));
        return UnderRoots(path) && signer != null && (!path.StartsWith(Windows, StringComparison.Ordinal) || S.WindowsSigners.Contains(signer));
    }

    /// Text from an app, as Rig passes it on: one line, plain ASCII, at most 80 characters.
    public static string Plain(string? text, int most = 80)
    {
        var line = new StringBuilder();
        foreach (char c in (text ?? "").Trim())
        {
            char to = c switch { '‘' or '’' => '\'', '“' or '”' => '"', '–' or '—' => '-', ' ' or '\t' or '\r' or '\n' => ' ', '®' or '™' or '©' => '\0', < ' ' or > '~' => '?', _ => c };
            if (to == '\0' || (to == ' ' && line.Length > 0 && line[^1] == ' ')) continue;
            line.Append(to);
        }
        string s = line.ToString().Trim();
        return s.Length <= most ? s : s[..most];
    }
}

/// Who signed a program, by Windows' own check of the file or of the catalog that lists it.
public static class Signature
{
    /// The signer's name when the file's signature is valid (empty when Windows won't name the signer), else null.
    public static string? Signer(string path)
    {
        try
        {
            if (Valid(path)) return Subject(path);
            return Catalog(path) is string catalog && Valid(catalog) ? Subject(catalog) : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or DllNotFoundException or EntryPointNotFoundException) { return null; }
    }

    static string Subject(string file)
    {
        try
        {
#pragma warning disable SYSLIB0057
            using var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(file));
#pragma warning restore SYSLIB0057
            return ScreenRules.Plain(cert.GetNameInfo(X509NameType.SimpleName, forIssuer: false));
        }
        catch (Exception e) when (e is System.Security.Cryptography.CryptographicException or IOException) { return ""; }
    }

    static bool Valid(string file)
    {
        IntPtr path = Marshal.StringToHGlobalUni(file), info = Marshal.AllocHGlobal(Marshal.SizeOf<WINTRUST_FILE_INFO>());
        try
        {
            Marshal.StructureToPtr(new WINTRUST_FILE_INFO { cbStruct = (uint)Marshal.SizeOf<WINTRUST_FILE_INFO>(), pcwszFilePath = path }, info, false);
            var data = new WINTRUST_DATA
            {
                cbStruct = (uint)Marshal.SizeOf<WINTRUST_DATA>(), dwUIChoice = WTD_UI_NONE, fdwRevocationChecks = WTD_REVOKE_NONE,
                dwUnionChoice = WTD_CHOICE_FILE, pFile = info, dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL,
            };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            return WinVerifyTrust(IntPtr.Zero, ref action, ref data) == 0;
        }
        finally
        {
            Marshal.FreeHGlobal(info);
            Marshal.FreeHGlobal(path);
        }
    }

    /// The catalog Windows trusts that lists this file's hash, or null.
    static string? Catalog(string file)
    {
        foreach (string? algorithm in new[] { "SHA256", null })
        {
            if (!CryptCATAdminAcquireContext2(out IntPtr admin, IntPtr.Zero, algorithm, IntPtr.Zero, 0)) continue;
            try
            {
                using var f = File.OpenHandle(file, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
                uint size = 0;
                CryptCATAdminCalcHashFromFileHandle2(admin, f, ref size, null, 0);
                if (size == 0) continue;
                var hash = new byte[size];
                if (!CryptCATAdminCalcHashFromFileHandle2(admin, f, ref size, hash, 0)) continue;
                IntPtr found = CryptCATAdminEnumCatalogFromHash(admin, hash, size, 0, IntPtr.Zero);
                if (found == IntPtr.Zero) continue;
                try
                {
                    var info = new CATALOG_INFO { cbStruct = (uint)Marshal.SizeOf<CATALOG_INFO>() };
                    if (CryptCATCatalogInfoFromContext(found, ref info, 0)) return info.wszCatalogFile;
                }
                finally { CryptCATAdminReleaseCatalogContext(admin, found, 0); }
            }
            finally { CryptCATAdminReleaseContext(admin, 0); }
        }
        return null;
    }

    const uint WTD_UI_NONE = 2, WTD_REVOKE_NONE = 0, WTD_CHOICE_FILE = 1, WTD_CACHE_ONLY_URL_RETRIEVAL = 0x1000;

    [StructLayout(LayoutKind.Sequential)] struct WINTRUST_FILE_INFO { public uint cbStruct; public IntPtr pcwszFilePath, hFile, pgKnownSubject; }
    [StructLayout(LayoutKind.Sequential)]
    struct WINTRUST_DATA
    {
        public uint cbStruct; public IntPtr pPolicyCallbackData, pSIPClientData; public uint dwUIChoice, fdwRevocationChecks, dwUnionChoice; public IntPtr pFile;
        public uint dwStateAction; public IntPtr hWVTStateData, pwszURLReference; public uint dwProvFlags, dwUIContext; public IntPtr pSignatureSettings;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct CATALOG_INFO { public uint cbStruct; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string wszCatalogFile; }

    [DllImport("wintrust.dll")] static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WINTRUST_DATA data);
    [DllImport("wintrust.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CryptCATAdminAcquireContext2(out IntPtr admin, IntPtr subsystem, string? algorithm, IntPtr policy, uint flags);
    [DllImport("wintrust.dll", SetLastError = true)] static extern bool CryptCATAdminCalcHashFromFileHandle2(IntPtr admin, SafeFileHandle file, ref uint size, byte[]? hash, uint flags);
    [DllImport("wintrust.dll")] static extern IntPtr CryptCATAdminEnumCatalogFromHash(IntPtr admin, byte[] hash, uint size, uint flags, IntPtr previous);
    [DllImport("wintrust.dll", CharSet = CharSet.Unicode)] static extern bool CryptCATCatalogInfoFromContext(IntPtr catalog, ref CATALOG_INFO info, uint flags);
    [DllImport("wintrust.dll")] static extern bool CryptCATAdminReleaseCatalogContext(IntPtr admin, IntPtr catalog, uint flags);
    [DllImport("wintrust.dll")] static extern bool CryptCATAdminReleaseContext(IntPtr admin, uint flags);
}

/// One control on the way, as a look found it: its name as the app wrote it, the same in plain words, its UI Automation
/// control type, automation id and class. A replay finds it by these and never by where it sits.
public sealed record Hop(string Name, string Says, int Type, string Id, string Cls)
{
    public JsonObject ToJson() => new() { ["name"] = Name, ["says"] = Says, ["type"] = Type, ["id"] = Id, ["cls"] = Cls };
    public static Hop From(JsonNode? n) => new(n?["name"]?.ToString() ?? "", n?["says"]?.ToString() ?? "", (int)Json.Num(n?["type"], 0), n?["id"]?.ToString() ?? "", n?["cls"]?.ToString() ?? "");
}

/// What a look found, as the helper keeps it and hands it to the worker for a replay. `Kind` is toggle, choice or range.
/// `Options` pairs each choice's own name with its plain words. `Pid` is the window's process when the worker looked.
public sealed record ScreenLook(string App, string Name, string Image, string Signer, List<Hop> Hops, Hop Target, string Kind, string Value, List<(string Name, string Says)> Options, double Min, double Max, bool Clean, int Pid = 0)
{
    public JsonObject ToJson() => new()
    {
        ["app"] = App, ["name"] = Name, ["image"] = Image, ["signer"] = Signer, ["hops"] = new JsonArray(Hops.Select(h => (JsonNode)h.ToJson()).ToArray()), ["target"] = Target.ToJson(),
        ["kind"] = Kind, ["value"] = Value, ["options"] = new JsonArray(Options.Select(o => (JsonNode)new JsonObject { ["name"] = o.Name, ["says"] = o.Says }).ToArray()),
        ["min"] = Min.ToString("R", CultureInfo.InvariantCulture), ["max"] = Max.ToString("R", CultureInfo.InvariantCulture), ["clean"] = Clean, ["pid"] = Pid,
    };

    /// Reads a look the worker answered or a record kept. Every word in it is held to Rig's plain line again, because the
    /// worker's answer is data from outside. Null when a part is missing.
    public static ScreenLook? From(JsonNode? n)
    {
        if (n is not JsonObject o || o["hops"] is not JsonArray hops || o["options"] is not JsonArray options || o["target"] is not JsonObject target) return null;
        static Hop Held(JsonNode? h) { var hop = Hop.From(h); return hop with { Says = ScreenRules.Plain(hop.Says) }; }
        string kind = o["kind"]?.ToString() ?? "";
        if (kind is not ("toggle" or "choice" or "range") || hops.Count > ScreenStep.MaxGoal) return null;
        double.TryParse(o["min"]?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double min);
        double.TryParse(o["max"]?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double max);
        var look = new ScreenLook(o["app"]?.ToString() ?? "", ScreenRules.Plain(o["name"]?.ToString()), o["image"]?.ToString() ?? "", ScreenRules.Plain(o["signer"]?.ToString()), hops.Select(Held).ToList(), Held(target), kind,
            ScreenRules.Plain(o["value"]?.ToString()), options.Select(x => (x?["name"]?.ToString() ?? "", ScreenRules.Plain(x?["says"]?.ToString()))).ToList(), min, max, o["clean"]?.GetValueKind() == JsonValueKind.True,
            (int)Json.Num(o["pid"], 0));
        return look.Target.Says.Length == 0 || look.Options.Count > ScreenStep.MaxOptions || look.Options.Any(x => x.Says.Length == 0) ? null : look;
    }

    /// The state as one line, the same whenever the state is the same.
    public string Line(string value) => $"{Target.Says}: {value}";

    /// A number as Rig writes it, and whether two values of this control are the same.
    public static string Number(double d) => Math.Round(d, 6).ToString("0.######", CultureInfo.InvariantCulture);
    public bool Same(string a, string b) =>
        Kind != "range" ? a == b
        : double.TryParse(a, NumberStyles.Float, CultureInfo.InvariantCulture, out double x) && double.TryParse(b, NumberStyles.Float, CultureInfo.InvariantCulture, out double y) && Math.Abs(x - y) < 0.0000005;

    static readonly Regex Num = new(@"^-?\d{1,9}(\.\d{1,6})?\z");

    /// Whether the control took this value when Rig looked: lookTakes in screen.ts.
    public bool Takes(string to) =>
        Kind != "range" ? Options.Any(o => o.Says == to)
        : Num.IsMatch(to) && double.Parse(to, CultureInfo.InvariantCulture) >= Min && double.Parse(to, CultureInfo.InvariantCulture) <= Max;
}

public sealed class ScreenStep : INativeStep
{
    public const string OpName = "screen";
    public const int MaxGoal = 8, MaxOptions = 100, MaxLooks = 32;

    public string Name => OpName;

    /// The looks this run of the helper answered, each until it runs out. Nothing on disk holds one until its step is applied.
    static readonly ConcurrentDictionary<string, (ScreenLook Look, long Until)> Looks = new();
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static readonly Regex Word = new(@"^[\x20-\x7e]{1,80}\z");

    /// Keeps a look and answers its id. Internal so the self-test can keep one the worker never made.
    internal static (string Id, long Until) Keep(ScreenLook look)
    {
        foreach (var old in Looks.Where(l => l.Value.Until <= Now).ToList()) Looks.TryRemove(old.Key, out _);
        foreach (var extra in Looks.OrderByDescending(l => l.Value.Until).Skip(MaxLooks - 1).ToList()) Looks.TryRemove(extra.Key, out _);
        string id = CommandStore.NewId();
        long until = DateTimeOffset.UtcNow.AddMinutes(ScreenRules.LookMinutes).ToUnixTimeMilliseconds();
        Looks[id] = (look, until);
        return (id, until);
    }

    /// screen.look, in the helper: checks the app's name against the rules, has the worker look, and keeps what it found.
    public static JsonObject LookFor(JsonNode? p, bool selfTest, Func<JsonObject, NativeWorker.Answer> ask)
    {
        static JsonObject No(string words, bool clean = true, JsonArray? shows = null)
        {
            var o = new JsonObject { ["refused"] = words, ["clean"] = clean };
            if (shows is { Count: > 0 }) o["shows"] = shows;
            return o;
        }
        string? app = p?["app"] is JsonValue a && a.TryGetValue(out string? text) ? text : null;
        var goal = (p?["goal"] as JsonArray ?? []).Select(g => g is JsonValue v && v.TryGetValue(out string? s) ? s.Trim() : "").ToList();
        ScreenApp resolved;
        try { resolved = ScreenRules.Resolve(app, selfTest); }
        catch (RigException e) { return No(e.Message); }
        if (goal.Count is 0 or > MaxGoal || goal.Any(g => !Word.IsMatch(g))) return No(ScreenRules.Words("goal"));
        if (goal.Any(ScreenRules.NeverName)) return No(ScreenRules.Words("never-name"));

        NativeWorker.Answer said;
        try { said = ask(new JsonObject { ["name"] = OpName, ["app"] = app, ["goal"] = new JsonArray(goal.Select(g => (JsonNode)g).ToArray()) }); }
        catch (RigException e) { return No(e.Message); }
        // What stopped a walk can name what the window showed, so it counts as the app's text unless the worker says otherwise.
        if (!said.Ok) return No(ScreenRules.Plain(said.Error, 300), clean: false);
        bool clean = said.Result["clean"]?.GetValueKind() == JsonValueKind.True;
        if (said.Result["refused"] is JsonNode refused)
            return No(ScreenRules.Plain(refused.ToString(), 300), clean,
                new JsonArray((said.Result["shows"] as JsonArray ?? []).Take(40).Select(s => (JsonNode)ScreenRules.Plain(s?.ToString())).ToArray()));
        if (ScreenLook.From(said.Result["look"]) is not ScreenLook seen || seen.App != app) return No("Rig's worker answered with something that isn't a look.");
        // The worker's word on the program is data from outside: the program, its package, its signer and what counts as
        // clean are read by the helper from the window's process.
        string? image = Native.ProcessImage(seen.Pid), family = Native.PackageFamily(seen.Pid);
        if (image == null || !string.Equals(image, seen.Image, StringComparison.OrdinalIgnoreCase) || !ScreenRules.Is(resolved, image, family)) return No(ScreenRules.Words("app"));
        string? signer = Signature.Signer(image);
        bool trusted = ScreenRules.Trusted(resolved, image, signer, family);
        if (resolved.Listed && !trusted) return No(ScreenRules.Words("not-maker"));
        var look = seen with { Image = image, Signer = signer ?? "", Clean = seen.Clean && trusted };

        var (id, until) = Keep(look);
        var reply = new JsonObject
        {
            ["lookId"] = id, ["path"] = new JsonArray(new[] { look.Name }.Concat(goal).Select(w => (JsonNode)w).ToArray()), ["value"] = look.Value,
            ["clean"] = look.Clean, ["expiresAt"] = DateTimeOffset.FromUnixTimeMilliseconds(until).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
        };
        if (look.Kind == "range") reply["range"] = new JsonObject { ["min"] = look.Min, ["max"] = look.Max };
        else reply["options"] = new JsonArray(look.Options.Select(o => (JsonNode)o.Says).ToArray());
        return reply;
    }

    static (JsonObject Kept, string LookId, string To) Parts(JsonObject op)
    {
        static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;
        if (Str(op["lookId"]) is not string lookId || !CommandStore.Id.IsMatch(lookId) || Str(op["to"]) is not string to || !Word.IsMatch(to) || Str(op["does"]) is not string does || does.Trim().Length == 0 || does.Length > 500)
            throw new RigException(ScreenRules.Words("op"));
        return (new JsonObject { ["name"] = OpName, ["lookId"] = lookId, ["to"] = to, ["does"] = does }, lookId, to);
    }

    static NativeCheck Checked(JsonObject kept, ScreenLook look, string to)
    {
        // The rules may have changed since the look, and they have the last word on the app.
        ScreenRules.Resolve(look.App, selfTest: look.App == ScreenRules.SelfTestApp);
        if (!look.Takes(to)) throw new RigException(ScreenRules.Words("not-offered"));
        if (ScreenRules.NeverName(to)) throw new RigException(ScreenRules.Words("never-name"));
        if (!look.Clean) throw new RigException(ScreenRules.Words("unclean"));
        return new NativeCheck(kept, 3, [ScreenRules.Words("tier")], [], look.ToJson(), look.Line(look.Value));
    }

    public NativeCheck Check(JsonObject op)
    {
        var (kept, lookId, to) = Parts(op);
        if (!Looks.TryGetValue(lookId, out var found) || found.Until <= Now) throw new RigException(ScreenRules.Words("unknown-look"));
        return Checked(kept, found.Look, to);
    }

    public NativeCheck Recheck(JsonObject op, JsonObject held)
    {
        var (kept, _, to) = Parts(op);
        return Checked(kept, ScreenLook.From(held) ?? throw new RigException(ScreenRules.Words("unknown-look")), to);
    }

    // ----- In the worker -----

    static ScreenLook Held(JsonObject op) => ScreenLook.From(op["held"]) ?? throw new RigException(ScreenRules.Words("unknown-look"));
    static ScreenApp App(ScreenLook look) => ScreenRules.Resolve(look.App, selfTest: look.App == ScreenRules.SelfTestApp);

    /// The worker's part of screen.look: `{ look }`, or `{ refused, shows, clean }` when the walk stopped short.
    public JsonObject Look(JsonObject op, bool selfTest)
    {
        string app = op["app"]?.ToString() ?? "";
        var goal = (op["goal"] as JsonArray ?? []).Select(g => g?.ToString() ?? "").ToList();
        using var walk = new ScreenWalk(ScreenRules.Resolve(app, selfTest), changing: false, goal.LastOrDefault() ?? "");
        return walk.Look(app, goal);
    }

    public string Preview(JsonObject op)
    {
        var look = Held(op);
        using var walk = new ScreenWalk(App(look), changing: false, look.Target.Says);
        return look.Line(walk.Read(look));
    }

    public JsonObject Apply(JsonObject op)
    {
        var look = Held(op);
        string to = op["to"]!.ToString();
        using var walk = new ScreenWalk(App(look), changing: true, look.Target.Says);
        var back = new JsonObject { ["was"] = look.Value, ["after"] = look.Line(to) };
        // Stopped part way, or left by the app half done, the change stands as it is with its undo offered, unread.
        if (walk.Set(look, from: look.Value, to, back) is string unfinished) back["unfinished"] = unfinished;
        return back;
    }

    public string? Verify(JsonObject op)
    {
        var look = Held(op);
        string to = op["to"]!.ToString();
        using var walk = new ScreenWalk(App(look), changing: false, look.Target.Says);
        string now = walk.Read(look);
        return look.Same(now, to) ? null : $"{look.Target.Says} reads {now}, not {to}.";
    }

    public void Undo(JsonObject op, JsonObject back)
    {
        var look = Held(op);
        string was = back["was"]?.ToString() ?? throw new RigException("Rig has no note of the value this control had.");
        using var walk = new ScreenWalk(App(look), changing: true, look.Target.Says);
        if (walk.Set(look, from: null, to: was) is string stopped) throw new RigException(stopped);
    }
}

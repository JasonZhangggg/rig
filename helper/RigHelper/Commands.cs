// The general command runner: "command.check", "command.preview",
// "command.apply", "command.undo" and "command.read" (packages/core/src/change.ts
// has the shapes). The app, its web view and the server are all on the far side of
// the pipe, so nothing they send is trusted:
//
//   preview  checks the command with PowerShell's own parser, runs `read` as
//            the person, and stores the command and its verdict under a
//            nonce that works once and runs out after a few minutes.
//   apply    takes only the nonce. It works out the stored command's
//            fingerprint again and holds it to the one preview gave, checks
//            again, takes a snapshot, runs `run` from a file only admins can
//            change, compares the never-list places before and after, and puts
//            everything back on a hit or a failure.
//   undo     takes only the id of an applied change, and runs only what that
//            change's approval covered, with no more rights than it ran with,
//            between readings of the never-list places too. It leaves alone
//            what changed since unless told to put it back anyway, and checks
//            afterwards that each place really is as it was.
//
// A command that needs admin rights runs only after RigHelper.exe
// --approve-command marked its nonce, and that mode only works behind
// Windows' own permission prompt. Everything else runs with the person's own
// rights, so the pipe can't be used to get more than the person already has.
//
// What is stored lives in %ProgramData%\Rig\Commands, which only admins and
// the system can read or change. A helper without admin rights keeps its own
// store under the person's profile and can't run admin commands at all; a
// helper with admin rights never reads that one.

using System.Collections.Concurrent;
using System.Management;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public sealed record Pending(string Nonce, string Hash, Command Cmd, Verdict Verdict, string Person, long ExpiresAt, long ApprovedAt)
{
    public JsonObject ToJson() => new()
    {
        ["nonce"] = Nonce, ["hash"] = Hash, ["cmd"] = Cmd.ToJson(), ["verdict"] = Verdict.ToJson(),
        ["person"] = Person, ["expiresAt"] = ExpiresAt, ["approvedAt"] = ApprovedAt,
    };

    public static Pending? From(JsonNode? n)
    {
        if (n is not JsonObject o || Command.From(o["cmd"], out _) is not Command cmd || Verdict.From(o["verdict"]) is not Verdict verdict) return null;
        return new Pending(o["nonce"]?.ToString() ?? "", o["hash"]?.ToString() ?? "", cmd, verdict,
            o["person"]?.ToString() ?? "", (long)Json.Num(o["expiresAt"], 0), (long)Json.Num(o["approvedAt"], 0));
    }
}

public sealed class CommandStore
{
    public const int MaxPending = 32, KeepRecordDays = 90;
    public static readonly Regex Id = new("^[0-9a-f]{32}$");
    static readonly SecurityIdentifier Admins = new(WellKnownSidType.BuiltinAdministratorsSid, null), LocalSystem = new(WellKnownSidType.LocalSystemSid, null);

    public string Root { get; }
    readonly bool secured;
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public static string NewId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public static string AdminRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rig", "Commands");

    /// The store for this process: the admin-only one when it has admin rights, the person's own otherwise.
    public static CommandStore Open() => Native.IsAdmin()
        ? new CommandStore(AdminRoot, secured: true)
        : new CommandStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rig", "Commands"), secured: false);

    public CommandStore(string root, bool secured)
    {
        Root = root;
        this.secured = secured;
        Setup();
    }

    void Setup()
    {
        if (secured)
        {
            // ProgramData lets anyone make folders. The parent is always taken over and locked, so no one else can add or
            // swap anything beside the store; a store someone else made, or a link in its place, is replaced, so nothing
            // planted there is ever read.
            string parent = Path.GetDirectoryName(Root)!;
            if (Directory.Exists(parent) && File.GetAttributes(parent).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(parent);
            Directory.CreateDirectory(parent);
            Lock(parent, new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null));
            if (Directory.Exists(Root) && File.GetAttributes(Root).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(Root);
            if (Directory.Exists(Root) && !OwnedByAdmins(Root)) Directory.Delete(Root, recursive: true);
            Directory.CreateDirectory(Root);
            Lock(Root, reader: null);
        }
        foreach (string sub in new[] { "pending", "records", "work", "scripts" }) Directory.CreateDirectory(Path.Combine(Root, sub));
    }

    /// Whether only admins could have put anything in the store: it, the folders above it and every folder and file in it
    /// are owned by admins, the system or Windows' installer, and none is a link. Always true for the person's own store.
    public bool Sound() => !secured || AdminFile.TrustedTree(Root);

    /// Whether only admins could have put what is at this path in the store.
    public bool Trusted(string path) => !secured || AdminFile.Trusted(path);

    /// Empties the store and sets it up again. What it held, the records of past changes among them, is gone.
    public void Rebuild()
    {
        if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
        Setup();
    }

    static bool OwnedByAdmins(string dir)
    {
        var owner = new DirectoryInfo(dir).GetAccessControl().GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
        return owner != null && (owner.Equals(Admins) || owner.Equals(LocalSystem));
    }

    /// Admins and the system own and control the folder and all in it; `reader` may read.
    static void Lock(string dir, SecurityIdentifier? reader)
    {
        var sec = new DirectorySecurity();
        sec.SetOwner(Admins);
        sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        const InheritanceFlags all = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        sec.AddAccessRule(new FileSystemAccessRule(LocalSystem, FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        sec.AddAccessRule(new FileSystemAccessRule(Admins, FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        if (reader != null) sec.AddAccessRule(new FileSystemAccessRule(reader, FileSystemRights.ReadAndExecute, all, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(dir).SetAccessControl(sec);
    }

    public string Work => Path.Combine(Root, "work");

    /// The folder every script starts in, emptied first. Only admins can put anything in it and anyone can open it, so a
    /// place named without its full path lands nowhere that matters, whoever the script runs as.
    public string Empty()
    {
        string dir = Path.Combine(Root, "empty");
        if (Directory.Exists(dir) && File.GetAttributes(dir).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(dir);
        if (Directory.Exists(dir) && Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir, recursive: true);
        Directory.CreateDirectory(dir);
        if (secured) Lock(dir, new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null));
        return dir;
    }
    public string RecordDir(string id) => Path.Combine(Root, "records", id);

    /// Where scripts that run as the person are written: the person can read them and only admins can change them.
    public string PersonScripts(string sid)
    {
        string dir = Path.Combine(Root, "scripts", sid);
        Directory.CreateDirectory(dir);
        if (secured) Lock(dir, new SecurityIdentifier(sid));
        return dir;
    }

    static JsonNode? ReadJson(string file)
    {
        try { return JsonNode.Parse(File.ReadAllText(file)); } catch { return null; }
    }

    static void WriteJson(string file, JsonNode node)
    {
        File.WriteAllText(file + ".tmp", node.ToJsonString());
        File.Move(file + ".tmp", file, overwrite: true);
    }

    string PendingFile(string nonce) => Path.Combine(Root, "pending", nonce + ".json");

    public void Save(Pending p)
    {
        var old = new DirectoryInfo(Path.Combine(Root, "pending")).GetFiles().OrderByDescending(f => f.LastWriteTimeUtc).ToList();
        foreach (var f in old.Where((f, i) => i >= MaxPending - 1 || f.LastWriteTimeUtc < DateTime.UtcNow.AddMinutes(-2 * Commands.NonceMinutes)))
            try { f.Delete(); } catch { }
        WriteJson(PendingFile(p.Nonce), p.ToJson());
    }

    /// A stored command that hasn't run out, left in place.
    public Pending? Peek(string nonce) =>
        Id.IsMatch(nonce) && Pending.From(ReadJson(PendingFile(nonce))) is Pending p && p.Nonce == nonce && p.ExpiresAt > Now ? p : null;

    public void Approve(Pending p) => WriteJson(PendingFile(p.Nonce), (p with { ApprovedAt = Now }).ToJson());

    /// Takes a stored command out of the store, so its nonce works once. Null when it is unknown, used or too old.
    public Pending? Take(string nonce)
    {
        if (!Id.IsMatch(nonce)) return null;
        string file = PendingFile(nonce), mine = file + "." + NewId();
        try { File.Move(file, mine); } catch (IOException) { return null; }
        try { return Pending.From(ReadJson(mine)) is Pending p && p.Nonce == nonce && p.ExpiresAt > Now ? p : null; }
        finally { try { File.Delete(mine); } catch { } }
    }

    /// Counts one more tier 2 or 3 change today. False when today's limit is already reached.
    public bool CountToday(int cap)
    {
        string file = Path.Combine(Root, "cap.json"), today = DateTime.Now.ToString("yyyy-MM-dd");
        var o = ReadJson(file);
        int count = o?["day"]?.ToString() == today ? (int)Json.Num(o["count"], cap) : 0;
        if (count >= cap) return false;
        WriteJson(file, new JsonObject { ["day"] = today, ["count"] = count + 1 });
        return true;
    }

    public JsonObject? LastRestorePoint
    {
        get => ReadJson(Path.Combine(Root, "restore.json")) as JsonObject;
        set => WriteJson(Path.Combine(Root, "restore.json"), value!);
    }

    public string NewRecord(string id)
    {
        foreach (var d in new DirectoryInfo(Path.Combine(Root, "records")).GetDirectories().Where(d => d.CreationTimeUtc < DateTime.UtcNow.AddDays(-KeepRecordDays)))
            try { d.Delete(recursive: true); } catch { }
        return Directory.CreateDirectory(RecordDir(id)).FullName;
    }

    public void SaveRecord(string id, JsonObject record) => WriteJson(Path.Combine(RecordDir(id), "record.json"), record);
    public JsonObject? Record(string id) => Id.IsMatch(id) ? ReadJson(Path.Combine(RecordDir(id), "record.json")) as JsonObject : null;
    public void DropRecord(string id) { try { Directory.Delete(RecordDir(id), recursive: true); } catch { } }
}

/// Windows restore points, as a last resort the undo can name. Best effort: at most one a day, and never in the way.
static class RestorePoints
{
    const int WaitMs = 15_000;

    public static bool ProtectionOff()
    {
        using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore");
        return k?.GetValue("RPSessionInterval") is not int on || on == 0;
    }

    /// The restore point to name for a change made now: one from the last day, or a new one if Windows makes it in time.
    public static JsonObject? Ensure(CommandStore store)
    {
        if (!Native.IsAdmin() || ProtectionOff()) return null;
        if (store.LastRestorePoint is JsonObject last && DateTimeOffset.TryParse(last["at"]?.ToString(), out var at) && at > DateTimeOffset.UtcNow.AddDays(-1)) return last;
        var making = Task.Run(Create);
        if (!making.Wait(WaitMs) || making.Result is not JsonObject made) return null;
        store.LastRestorePoint = made;
        return made.DeepClone().AsObject();
    }

    static JsonObject? Create()
    {
        try
        {
            using var sr = new ManagementClass(@"\\.\root\default:SystemRestore");
            using var args = sr.GetMethodParameters("CreateRestorePoint");
            args["Description"] = "Rig: before a change";
            args["RestorePointType"] = 12;
            args["EventType"] = 100;
            using var done = sr.InvokeMethod("CreateRestorePoint", args, null);
            if (Convert.ToInt64(done["ReturnValue"]) != 0) return null;
            // Windows makes at most one a day by itself; whichever is newest is the one to go back to.
            using var all = new ManagementObjectSearcher(@"root\default", "SELECT SequenceNumber, Description, CreationTime FROM SystemRestore");
            var newest = all.Get().Cast<ManagementBaseObject>().OrderByDescending(p => Convert.ToInt64(p["SequenceNumber"])).FirstOrDefault();
            if (newest == null) return null;
            var made = ManagementDateTimeConverter.ToDateTime(newest["CreationTime"].ToString()).ToUniversalTime();
            return new JsonObject { ["seq"] = Convert.ToInt64(newest["SequenceNumber"]), ["name"] = newest["Description"]?.ToString() ?? "", ["at"] = made.ToString("yyyy-MM-ddTHH:mm:ssZ") };
        }
        catch { return null; }
    }
}

public sealed class Commands(CommandStore store, int? appPid, bool restorePoints = true)
{
    public const int NonceMinutes = 10, DailyCap = 12;
    public const int Expired = 10, Changed = 11;
    public const int ParseTimeoutMs = 30_000, ReadTimeoutMs = 20_000, RunTimeoutMs = 120_000;

    /// What preview gave out in this run of the helper: each nonce and the fingerprint of the command it stands for. A nonce
    /// apply hasn't seen given out here is unknown, whatever the store holds.
    static readonly ConcurrentDictionary<string, string> Issued = new();

    /// The self-test's way to run more than the checked script, to show that what the check can't see is still caught.
    /// Only code in this process can set it; nothing that comes over the pipe reaches it.
    internal string? TestOnlyExtra { get; set; }

    /// The self-test's way to stand in for a Rig app started with "Run as administrator", or, set false, for one started
    /// normally: with admin rights the self-test is itself the app, and so is elevated.
    internal bool? TestOnlyElevatedApp { get; set; }

    public const string AppElevated = "Rig is running as administrator, so it can't keep changes to what you approved. Open Rig normally and ask again.";
    public const string StoreRebuilt = "Rig found something in its own store of changes that it didn't put there, so it cleared the store and nothing ran. Ask again.";
    public const string AppElevatedUndo = "Rig is running as administrator, so it can't keep the undo to what you approved. Open Rig normally and undo again.";

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;
    static JsonObject Refused(Verdict v) => new() { ["outcome"] = "refused", ["verdict"] = v.ToJson() };
    static JsonObject Refused(string words) => Refused(Verdict.Refuse(words));
    static Command? CommandOf(JsonNode? p, out string? problem) => Command.From(p?["cmd"], out problem);

    public JsonNode Handle(string method, JsonNode? p)
    {
        switch (method)
        {
            case "command.check": { var cmd = CommandOf(p, out string? problem); return new JsonObject { ["verdict"] = Check(cmd, problem).Verdict.ToJson() }; }
            case "command.preview": { var cmd = CommandOf(p, out string? problem); return Preview(cmd, problem); }
            case "command.apply": return Apply(Str(p?["nonce"]) ?? "");
            case "command.undo": return Undo(Str(p?["id"]) ?? "", p?["force"]?.GetValueKind() == System.Text.Json.JsonValueKind.True);
            case "command.read": return ReadOnly(Str(p?["script"]) ?? "");
            default: throw new RigException($"Rig's helper doesn't know \"{method}\".");
        }
    }

    // ----- Check -----

    /// Runs the fixed parse script over these scripts, with this process's rights and nothing of the person's on its path.
    public IReadOnlyList<JsonNode?> Parse(IReadOnlyList<string> scripts)
    {
        string name = CommandStore.NewId();
        string script = Path.Combine(store.Work, "parse.ps1"), input = Path.Combine(store.Work, name + ".in"), output = Path.Combine(store.Work, name + ".out");
        try
        {
            PowerShellHost.Write(script, CommandCheck.Resource("Rig.Commands.CommandAst.ps1"), stopOnError: false);
            File.WriteAllLines(input, scripts.Select(s => Convert.ToBase64String(Encoding.UTF8.GetBytes(s))));
            if (!store.Trusted(script) || !store.Trusted(input)) throw new RigException("Rig's own folder has something in it that Rig didn't put there");
            var ran = PowerShellHost.RunHere(PowerShellHost.Args(script, input, output), ParseTimeoutMs, store.Empty(), store.Work);
            if (!File.Exists(output)) throw new RigException($"PowerShell's parser didn't answer ({(ran.TimedOut ? "it took too long" : ran.Printed.Split('\n')[0].Trim())})");
            return (JsonNode.Parse(File.ReadAllText(output))?["scripts"] as JsonArray ?? []).ToList();
        }
        finally
        {
            try { File.Delete(input); File.Delete(output); } catch { }
        }
    }

    public (Verdict Verdict, List<Write> Writes) Check(Command? cmd, string? problem = null)
    {
        try { return CommandCheck.CheckStep(cmd, problem, Parse); }
        catch (Exception e) { return (Verdict.Refuse($"{CommandCheck.Words("unreadable")}: {e.Message.TrimEnd('.')}."), []); }
    }

    /// Why an admin command can't run for this person, or null. With admin rights it runs as the account that answered
    /// Windows' prompt, and that account's own settings aren't the person's when someone else typed an admin's password.
    public static string? OtherAccount(bool admin, string helperSid, string personSid, Command cmd, IEnumerable<Write> writes)
    {
        if (!admin || string.Equals(helperSid, personSid, StringComparison.OrdinalIgnoreCase)) return null;
        bool mine = cmd.Touches.Any(t => t.Kind == "registry" && t.Text.StartsWith(@"HKCU\", StringComparison.OrdinalIgnoreCase))
            || writes.Any(w => w.Places.Any(p => p.StartsWith("hkcu", StringComparison.Ordinal)))
            || CommandCheck.NamesCurrentUser($"{cmd.Read}\n{cmd.Run}\n{cmd.Undo}");
        return mine ? "This needs admin rights, and the account that answered Windows' prompt isn't yours, so it would change that account's own settings instead of yours. Nothing ran. Split it: the part under HKCU doesn't need admin rights." : null;
    }

    // ----- Reads -----

    string Read(Person person, string script)
    {
        string file = Path.Combine(store.PersonScripts(person.Sid), CommandStore.NewId() + ".ps1");
        try
        {
            PowerShellHost.Write(file, script, stopOnError: false);
            var ran = person.Run(file, ReadTimeoutMs, store.Empty());
            return ran.TimedOut ? $"The read didn't finish in {ReadTimeoutMs / 1000} seconds, so Rig stopped it." : ran.Printed;
        }
        finally { try { File.Delete(file); } catch { } }
    }

    /// command.read: a read on its own, which must check as a read, run as the person.
    JsonObject ReadOnly(string script)
    {
        Verdict verdict;
        try
        {
            var parsed = CommandCheck.Precheck(script) == null ? Parse([script]) : [];
            verdict = CommandCheck.CheckScript(script, "read", parsed.Count > 0 ? parsed[0] : null);
        }
        catch (Exception e) { verdict = Verdict.Refuse($"{CommandCheck.Words("unreadable")}: {e.Message.TrimEnd('.')}."); }
        if (!verdict.Allowed || verdict.Tier != 0 || verdict.Admin) return new JsonObject { ["verdict"] = (verdict.Allowed ? Verdict.Refuse($"{CommandCheck.Words("not-read")}.", "notRead", verdict.Commands) : verdict).ToJson() };
        using var person = Person.Find(appPid);
        return new JsonObject { ["printed"] = Read(person, script) };
    }

    // ----- Preview -----

    JsonObject Preview(Command? cmd, string? problem)
    {
        var (verdict, _) = Check(cmd, problem);
        if (!verdict.Allowed || cmd == null) return Refused(verdict);
        using var person = Person.Find(appPid);
        // Nothing is approved yet, so everything here is read with the person's rights.
        var states = new TouchStates(person, admin: false);
        var touches = new JsonArray();
        foreach (var t in cmd.Touches)
        {
            string? value;
            try { value = TouchStates.Show(t, states.Read(t)); } catch (RigException e) { value = $"Rig couldn't read this as you: {e.Message}."; }
            touches.Add(new JsonObject { ["touch"] = t.ToJson(), ["value"] = value });
        }
        if (verdict.Tier >= 2 && RestorePoints.ProtectionOff())
            verdict = verdict with { Reasons = [.. verdict.Reasons, "Windows' System Protection is off on this PC, so there will be no restore point to fall back on."] };
        var pending = new Pending(CommandStore.NewId(), cmd.Hash(), cmd, verdict, person.Sid, DateTimeOffset.UtcNow.AddMinutes(NonceMinutes).ToUnixTimeMilliseconds(), 0);
        string read = Read(person, cmd.Read);
        store.Save(pending);
        Issued[pending.Nonce] = pending.Hash;
        return new JsonObject
        {
            ["outcome"] = "ready", ["nonce"] = pending.Nonce, ["expiresAt"] = DateTimeOffset.FromUnixTimeMilliseconds(pending.ExpiresAt).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            ["verdict"] = verdict.ToJson(), ["read"] = read, ["touches"] = touches,
        };
    }

    /// RigHelper.exe --approve-command <file> --hash <h>: started behind Windows' permission prompt when the person approves
    /// a command that needs admin rights. The file holds {nonce, owner}; the command itself is the one preview stored, and
    /// --hash is its fingerprint as the app showed it. Answers with its exit code only, so it writes nothing where the caller says.
    public static int ApproveFromFile(string file, string? hash, CommandStore? store = null)
    {
        try
        {
            if (!Native.IsAdmin()) return RecorderSetup.NotAdmin;
            var req = JsonNode.Parse(File.ReadAllText(file)) as JsonObject;
            if ((store ?? CommandStore.Open()) is not CommandStore s || s.Peek(Str(req?["nonce"]) ?? "") is not Pending pending) return Expired;
            if (pending.Person != Str(req?["owner"]) || string.IsNullOrEmpty(hash) || !string.Equals(pending.Hash, hash, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(pending.Cmd.Hash(), hash, StringComparison.OrdinalIgnoreCase)) return Changed;
            s.Approve(pending);
            return RecorderSetup.Ok;
        }
        catch { return RecorderSetup.Failed; }
    }

    // ----- Apply -----

    static string NextMidnight() => new DateTimeOffset(DateTime.Today.AddDays(1)).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    JsonObject Apply(string nonce)
    {
        var expired = new JsonObject { ["outcome"] = "expired" };
        if (!Issued.TryGetValue(nonce, out string? issued) || store.Peek(nonce) is not Pending waiting) return expired;
        using var person = Person.Find(appPid);
        if (person.Sid != waiting.Person) return expired;
        if (TestOnlyElevatedApp ?? person.Elevated) return Refused(AppElevated);
        if (!store.Sound())
        {
            store.Rebuild();
            Issued.TryRemove(nonce, out _);
            return Refused(StoreRebuilt);
        }
        // Windows' prompt wasn't answered with Yes: nothing ran, and the same card can ask again until it runs out.
        if (waiting.Verdict.Admin && Native.IsAdmin() && waiting.ApprovedAt == 0) return new JsonObject { ["outcome"] = "declined" };
        if (store.Take(nonce) is not Pending pending) return expired;
        Issued.TryRemove(nonce, out _);
        var cmd = pending.Cmd;
        if (cmd.Hash() != pending.Hash || pending.Hash != issued)
            return Refused("The change Rig stored isn't the one you looked at, so nothing ran. Look at it again.");
        var (verdict, writes) = Check(cmd);
        if (!verdict.Allowed) return Refused(verdict);
        if (verdict.Tier != pending.Verdict.Tier || verdict.Admin != pending.Verdict.Admin) return Refused("Rig's check of this change came out differently than when you looked at it, so nothing ran. Look at it again.");
        if (verdict.Admin)
        {
            if (!Native.IsAdmin()) return Refused("This needs admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then try again. Nothing ran.");
            if (pending.ApprovedAt == 0) return new JsonObject { ["outcome"] = "declined" };
            if (OtherAccount(true, Person.Mine(), person.Sid, cmd, writes) is string other) return Refused(other);
        }

        string id = CommandStore.NewId(), dir = store.NewRecord(id);
        var states = new TouchStates(person, verdict.Admin);
        var touches = cmd.Touches.ToList();
        var before = new List<JsonNode?>();
        for (int i = 0; i < touches.Count; i++)
        {
            try { before.Add(states.Read(touches[i], touches[i].Kind == "file" ? Path.Combine(dir, $"{i}.bin") : null)); }
            catch (RigException e)
            {
                store.DropRecord(id);
                return Refused($"Rig couldn't take a snapshot of {TouchStates.Name(touches[i])} ({e.Message}), so it didn't run this.");
            }
        }
        if (verdict.Tier >= 2 && !store.CountToday(DailyCap))
        {
            store.DropRecord(id);
            return new JsonObject { ["outcome"] = "limit", ["until"] = NextMidnight() };
        }
        var point = verdict.Tier >= 2 && restorePoints ? RestorePoints.Ensure(store) : null;
        var watch = new Sentinels(person, store.Work);
        var (guarded, moving) = watch.Baseline();
        string readBefore = Read(person, cmd.Read);

        var ran = RunScript(person, verdict.Admin, dir, id + "-run.ps1", TestOnlyExtra == null ? cmd.Run : $"{cmd.Run}\r\n{TestOnlyExtra}", stopOnError: true);

        var guardedAfter = watch.Read();
        var hits = Sentinels.Differences(guarded, guardedAfter, touches, moving);
        var after = touches.Select(t => { try { return states.Read(t); } catch (RigException) { return null; } }).ToList();
        var result = new JsonObject
        {
            ["before"] = readBefore, ["after"] = Read(person, cmd.Read),
            ["touches"] = new JsonArray(touches.Select((t, i) => (JsonNode)new JsonObject { ["touch"] = t.ToJson(), ["before"] = TouchStates.Show(t, before[i]), ["after"] = TouchStates.Show(t, after[i]) }).ToArray()),
            ["output"] = ran.Printed, ["alsoChanged"] = new JsonArray(),
        };

        if (hits.Count > 0 || !ran.Ok)
        {
            var left = new List<string>();
            for (int i = 0; i < touches.Count; i++) PutBack(states, touches[i], before[i], Path.Combine(dir, $"{i}.bin"), left);
            if (hits.Count > 0) left.AddRange(GuardBack(watch, guarded, guardedAfter, hits, touches, moving, verdict.Admin));
            left.AddRange(NotBack(states, touches, before));
            store.DropRecord(id);
            string? error = ran.TimedOut ? $"The change didn't finish in {RunTimeoutMs / 1000} seconds, so Rig stopped it." : !ran.Ok ? $"The change stopped with an error (exit code {ran.Exit})." : null;
            var rolled = new JsonObject
            {
                ["outcome"] = "rolledBack", ["result"] = result, ["sentinels"] = new JsonArray(Sentinels.Hits(guarded, guardedAfter, hits).Select(h => (JsonNode)h.ToJson()).ToArray()),
                ["left"] = new JsonArray(left.Distinct().Select(l => (JsonNode)l).ToArray()),
            };
            if (error != null) rolled["error"] = error;
            return rolled;
        }

        store.SaveRecord(id, new JsonObject
        {
            ["id"] = id, ["person"] = person.Sid, ["admin"] = verdict.Admin, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["cmd"] = cmd.ToJson(),
            ["before"] = new JsonArray(before.Select(s => s?.DeepClone()).ToArray()), ["after"] = new JsonArray(after.Select(s => s?.DeepClone()).ToArray()),
            ["restorePoint"] = point?.DeepClone(),
        });
        var undo = new JsonObject { ["kind"] = "command", ["id"] = id };
        if (cmd.Undo != null) undo["script"] = cmd.Undo;
        if (point != null) undo["restorePoint"] = point;
        undo["outside"] = new JsonArray();
        undo["fingerprint"] = Fingerprint(after);
        return new JsonObject { ["outcome"] = "applied", ["result"] = result, ["undo"] = undo };
    }

    /// Runs a script stored for the change: with the helper's rights only for a change approved as admin, otherwise as the person.
    PowerShellHost.Ran RunScript(Person person, bool admin, string dir, string name, string script, bool stopOnError)
    {
        string file = Path.Combine(admin ? dir : store.PersonScripts(person.Sid), name);
        try
        {
            PowerShellHost.Write(file, script, stopOnError);
            return admin ? PowerShellHost.RunHere(PowerShellHost.Args(file), RunTimeoutMs, store.Empty(), store.Work) : person.Run(file, RunTimeoutMs, store.Empty());
        }
        finally { try { File.Delete(file); } catch { } }
    }

    /// Puts back the never-list places a script changed, and says which it couldn't.
    static IEnumerable<string> GuardBack(Sentinels watch, Sentinels.Reading guarded, Sentinels.Reading after, List<(string, string)> hits, List<Touch> touches, IReadOnlySet<(string, string)> moving, bool admin)
    {
        watch.PutBack(guarded, after, hits, admin);
        var now = watch.Read();
        return Sentinels.Hits(guarded, now, Sentinels.Differences(guarded, now, touches, moving)).Select(h => $"{Sentinels.Words(h.Sentinel)}: {h.After}");
    }

    /// The touches that aren't back to their snapshot, read again after a restore.
    static List<string> NotBack(TouchStates states, List<Touch> touches, IReadOnlyList<JsonNode?> before)
    {
        var off = new List<string>();
        for (int i = 0; i < touches.Count; i++)
        {
            if (before[i] == null) continue;
            try
            {
                if (!TouchStates.SameCore(states.Read(touches[i]), before[i])) off.Add($"{TouchStates.Name(touches[i])} isn't back to how it was");
            }
            catch (RigException e) { off.Add($"{TouchStates.Name(touches[i])} ({e.Message})"); }
        }
        return off;
    }

    static string Fingerprint(IEnumerable<JsonNode?> states) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", states.Select(s => TouchStates.Core(s)?.ToJsonString() ?? "null"))))).ToLowerInvariant();

    static bool Same(JsonNode? a, JsonNode? b) => (a?.ToJsonString() ?? "null") == (b?.ToJsonString() ?? "null");

    /// Puts one touch back as it was, unless it already is. What it couldn't do goes on `left`.
    static void PutBack(TouchStates states, Touch t, JsonNode? was, string copy, List<string> left)
    {
        if (was == null) return;
        try
        {
            if (!Same(states.Read(t), was)) states.Write(t, was, copy);
        }
        catch (RigException e) { left.Add($"{TouchStates.Name(t)} ({e.Message})"); }
    }

    // ----- Undo -----

    JsonObject Undo(string id, bool force)
    {
        var unknown = new JsonObject { ["outcome"] = "unknown" };
        if (store.Record(id) is not JsonObject rec || Command.From(rec["cmd"], out _) is not Command cmd || rec["undone"] != null) return unknown;
        using var person = Person.Find(appPid);
        if (person.Sid != rec["person"]?.ToString()) return unknown;
        bool admin = rec["admin"]?.GetValue<bool>() == true;
        var point = rec["restorePoint"]?.DeepClone();
        JsonObject Failed(string error)
        {
            var o = new JsonObject { ["outcome"] = "failed", ["error"] = error };
            if (point != null) o["restorePoint"] = point;
            return o;
        }
        if (admin && !Native.IsAdmin()) return Failed("This change was made with admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then undo again.");
        if (TestOnlyElevatedApp ?? person.Elevated) return Failed(AppElevatedUndo);
        if (!store.Sound())
        {
            store.Rebuild();
            return Failed("Rig found something in its own store of changes that it didn't put there, so it cleared the store, and this change's snapshot with it. Nothing ran.");
        }

        var states = new TouchStates(person, admin);
        var touches = cmd.Touches.ToList();
        var before = rec["before"]!.AsArray().ToList();
        var after = rec["after"]!.AsArray().ToList();
        var failed = new List<string>();
        var changed = new List<string>();
        for (int i = 0; i < touches.Count; i++)
        {
            if (before[i] == null) continue;
            JsonNode? now;
            try { now = states.Read(touches[i]); } catch (RigException e) { failed.Add($"{TouchStates.Name(touches[i])} ({e.Message})"); continue; }
            // Still as Rig left it, or already back, is Rig's to put back. Anything else was changed since.
            if (!TouchStates.SameCore(now, after[i]) && !TouchStates.SameCore(now, before[i])) changed.Add(TouchStates.Name(touches[i]));
        }
        if (changed.Count > 0 && !force) return new JsonObject { ["outcome"] = "drifted", ["changed"] = new JsonArray(changed.Select(c => (JsonNode)c).ToArray()) };
        if (failed.Count > 0) return Failed($"Rig couldn't read everything this changed, so it put nothing back: {string.Join("; ", failed)}.");

        string dir = store.RecordDir(id);
        var stuck = new List<string>();
        void Restore()
        {
            stuck.Clear();
            for (int i = 0; i < touches.Count; i++) PutBack(states, touches[i], before[i], Path.Combine(dir, $"{i}.bin"), stuck);
        }
        Restore();

        var left = new List<string>();
        string? scriptProblem = null;
        if (cmd.Undo != null)
        {
            // The undo script was approved with the command. It runs with the rights the change ran with, never more,
            // and between readings of the never-list places like the change itself.
            var (verdict, writes) = Check(cmd);
            if (!verdict.Allowed || (verdict.Admin && !admin)) scriptProblem = "Rig's rules no longer allow the undo script, so it wasn't run";
            else if (OtherAccount(admin, Person.Mine(), person.Sid, cmd, writes) != null) scriptProblem = "the undo script would run as another account, so it wasn't run";
            else
            {
                var watch = new Sentinels(person, store.Work);
                var (guarded, moving) = watch.Baseline();
                var ran = RunScript(person, admin, dir, id + "-undo.ps1", cmd.Undo, stopOnError: false);
                var guardedAfter = watch.Read();
                var hits = Sentinels.Differences(guarded, guardedAfter, touches, moving);
                if (hits.Count > 0)
                {
                    var notBack = GuardBack(watch, guarded, guardedAfter, hits, touches, moving, admin).ToList();
                    foreach (var h in Sentinels.Hits(guarded, guardedAfter, hits)) left.Add($"the undo script changed a protected place ({Sentinels.Words(h.Sentinel)}), so Rig put it back");
                    failed.AddRange(notBack);
                }
                if (!ran.Ok) scriptProblem = ran.TimedOut ? "the undo script didn't finish" : $"the undo script stopped with an error: {ran.Printed.Split('\n')[0].Trim()}";
                // The snapshot has the last word on what it covers.
                Restore();
            }
        }

        failed.AddRange(stuck);
        failed.AddRange(NotBack(states, touches, before));
        // Without a snapshot of everything, the undo script was the only way back for the rest.
        if (scriptProblem != null && touches.Any(t => !t.Snapshotted)) failed.Add(scriptProblem);
        if (failed.Count > 0) return Failed($"Rig couldn't put everything back: {string.Join("; ", failed.Distinct())}.");
        rec["undone"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        store.SaveRecord(id, rec);
        return new JsonObject { ["outcome"] = "undone", ["printed"] = Read(person, cmd.Read), ["left"] = new JsonArray(left.Select(d => (JsonNode)d).ToArray()) };
    }
}
